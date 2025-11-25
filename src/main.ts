/// <reference types="google-apps-script" />
/// <reference path="./config.ts" />
/// <reference path="./types.d.ts" />
/**
 * GAS 本体。設定は config.generated.js または Script Properties から読む。
 * すべて TypeScript で書き、最後に global へエクスポートする。
 */

// デプロイスクリプト生成 + Script Properties をマージした設定
const CONFIG = getConfig(PropertiesService.getScriptProperties());

// シートの列定義（1行目のヘッダーと列数を揃える）
const ARTICLE_HEADERS = ['ID', 'Title', 'Content', 'CreatedAt', 'UpdatedAt', 'Tags', 'AuthorEmail', 'AuthorName'];
const SLACK_HEADERS = [
  'Timestamp',
  'UserID',
  'UserName',
  'UserAvatar',
  'Text',
  'ChannelID',
  'ChannelName',
  'MessageLink',
];

// ---- ユーティリティ ----

function guessNameFromEmail(email: string | null): string {
  if (!email) return '不明';
  return email.split('@')[0];
}

function openSheetOrThrow(name: string): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`シート "${name}" が見つかりません。`);
  return sheet;
}

// 記事リンクを生成（webAppUrl があれば優先、なければ ScriptApp から取得）
function buildArticleLink(id: string): string {
  const base =
    (CONFIG.webAppUrl && CONFIG.webAppUrl.replace(/\/$/, '')) ||
    (function () {
      try {
        return ScriptApp.getService().getUrl().replace(/\/$/, '');
      } catch (e) {
        return '';
      }
    })();
  if (!base) return '';
  return `${base}?articleId=${encodeURIComponent(id)}`;
}

function ensureSheet(ss: GoogleAppsScript.Spreadsheet.Spreadsheet, name: string, headers: string[]) {
  // 運用で直接 ensureSheet を実行すると引数なしで呼ばれがちなので防御する
  if (!ss || !name || !headers) {
    throw new Error('ensureSheet は内部用です。初期化は initSheets を実行してください。');
  }
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  // ヘッダー整備（既存データは壊さず1行目だけ上書き）
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const lastCol = sheet.getLastColumn();
  if (lastCol < headers.length) {
    sheet.insertColumnsAfter(lastCol, headers.length - lastCol);
  }
  return sheet;
}

// ---- エントリポイント / テンプレート ----

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('記事投稿＆一覧')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// テンプレート内の include 用
function include(filename: string) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getUserEmail() {
  return Session.getActiveUser().getEmail();
}

/**
 * シートとヘッダーをまとめて整備する（初回セットアップ用）。
 */
function ensureSheetStructure() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  ensureSheet(ss, CONFIG.sheets.articles, ARTICLE_HEADERS);
  ensureSheet(ss, CONFIG.sheets.slackMessages, SLACK_HEADERS);
  return 'シート構造を整備しました。';
}

// 呼び出し名をわかりやすくするためのエイリアス
function initSheets() {
  return ensureSheetStructure();
}

// ---- 記事系 ----

function getArticles(): ArticleRecord[] {
  try {
    const sheet = openSheetOrThrow(CONFIG.sheets.articles);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const values = sheet.getRange(2, 1, lastRow - 1, ARTICLE_HEADERS.length).getValues();
    return values.map((row) => ({
      id: String(row[0] ?? ''),
      title: String(row[1] ?? ''),
      content: String(row[2] ?? ''),
      createdAt: row[3] instanceof Date ? row[3].toISOString() : String(row[3] ?? ''),
      updatedAt: row[4] instanceof Date ? row[4].toISOString() : String(row[4] ?? ''),
      tags: (row[5] || '')
        .toString()
        .split(',')
        .map((t: string) => t.trim())
        .filter((t: string) => t),
      authorEmail: String(row[6] || ''),
      authorName: String(row[7] || guessNameFromEmail(row[6] as string | null)),
    }));
  } catch (e: unknown) {
    console.error('記事の取得に失敗:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

function addArticle(formData: { title: string; content: string; tagsString?: string }) {
  try {
    const sheet = openSheetOrThrow(CONFIG.sheets.articles);
    const now = new Date();
    const userEmail = Session.getActiveUser().getEmail();
    const userName = guessNameFromEmail(userEmail);

    const newId = Utilities.getUuid();
    sheet.appendRow([
      newId,
      formData.title,
      formData.content,
      now,
      now,
      formData.tagsString || '',
      userEmail,
      userName,
    ]);
    notifySlackNewArticle({
      id: newId,
      title: formData.title,
      author: userName,
    });
    return '記事を投稿しました。';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('記事追加に失敗:', msg);
    return `エラー: ${msg}`;
  }
}

function getArticleById(id: string): ArticleRecord | null {
  if (!id) return null;
  const articles = getArticles();
  return articles.find((a) => a.id === id) || null;
}

function updateArticle(articleData: { id: string; title: string; content: string; tagsString?: string }) {
  if (!articleData?.id) return 'エラー: 更新対象のIDがありません。';

  try {
    const sheet = openSheetOrThrow(CONFIG.sheets.articles);
    const values = sheet.getDataRange().getValues();
    const userEmail = Session.getActiveUser().getEmail();

    // 1行目はヘッダーなので 1 からスタート
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (row[0] === articleData.id && row[6] === userEmail) {
        rowIndex = i + 1; // シートの行番号（1始まり）
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error('更新対象の記事が見つからないか、編集権限がありません。');
    }

    sheet.getRange(rowIndex, 2).setValue(articleData.title);
    sheet.getRange(rowIndex, 3).setValue(articleData.content);
    sheet.getRange(rowIndex, 5).setValue(new Date()); // UpdatedAt
    sheet.getRange(rowIndex, 6).setValue(articleData.tagsString || '');

    return '記事を更新しました。';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('記事更新に失敗:', msg);
    return `エラー: ${msg}`;
  }
}

function deleteArticle(id: string) {
  if (!id) return 'エラー: 削除対象のIDがありません。';

  try {
    const sheet = openSheetOrThrow(CONFIG.sheets.articles);
    const values = sheet.getDataRange().getValues();
    const userEmail = Session.getActiveUser().getEmail();

    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (row[0] === id && row[6] === userEmail) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error('削除対象の記事が見つからないか、削除権限がありません。');
    }

    sheet.deleteRow(rowIndex);
    return '記事を削除しました。';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('記事削除に失敗:', msg);
    return `エラー: ${msg}`;
  }
}

// ---- Slack 取得系 ----

function getSlackMessages(options: { channelId?: string; limit?: number } = {}): SlackMessageRecord[] {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.spreadsheetId).getSheetByName(CONFIG.sheets.slackMessages);
    if (!sheet) return [];

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];

    const headers = values[0];
    const rows = values.slice(1);
    const idx = (name: string) => headers.indexOf(name);

    let messages: SlackMessageRecord[] = rows.map((row) => ({
      timestamp: String(row[idx('Timestamp')] ?? ''),
      user: {
        id: String(row[idx('UserID')] ?? ''),
        name: String(row[idx('UserName')] ?? ''),
        avatar: String(row[idx('UserAvatar')] ?? ''),
      },
      text: String(row[idx('Text')] ?? ''),
      channel: {
        id: String(row[idx('ChannelID')] ?? ''),
        name: String(row[idx('ChannelName')] ?? ''),
      },
      link: String(row[idx('MessageLink')] ?? ''),
      id: `slack-${row[idx('Timestamp')]}-${row[idx('ChannelID')]}`,
    }));

    if (options.channelId) {
      messages = messages.filter((msg) => msg.channel.id === options.channelId);
    }

    messages.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp));
    if (options.limit) messages = messages.slice(0, options.limit);
    return messages;
  } catch (e: unknown) {
    console.error('Slackメッセージの取得に失敗:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

function syncSlackMessages() {
  const slackToken = CONFIG.slack.botToken;
  const channelIds = CONFIG.slack.channelIds;

  if (!slackToken || channelIds.length === 0) {
    console.error('Slack設定が不足しています (token/channelIds)。');
    return;
  }

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.sheets.slackMessages);
  if (!sheet) {
    sheet = ensureSheet(ss, CONFIG.sheets.slackMessages, SLACK_HEADERS);
  }

  for (const channelId of channelIds) {
    fetchChannelAndAppend(sheet, slackToken, channelId);
  }
}

function fetchChannelAndAppend(sheet: GoogleAppsScript.Spreadsheet.Sheet, token: string, channelId: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const options = { method: 'get', headers, muteHttpExceptions: true } as GoogleAppsScript.URL_Fetch.URLFetchRequestOptions;
  const notificationMarker = '[NoteHubNotify]';

  const lastRow = sheet.getLastRow();
  let oldestTs = '0';
  if (lastRow > 1) {
    let rawTs = sheet.getRange(lastRow, 1).getValue();
    oldestTs = rawTs.toString();
    if (oldestTs.startsWith("'")) oldestTs = oldestTs.substring(1);
  }
  const oldestTrunc = Math.floor(parseFloat(oldestTs) * 100) / 100;

  let apiUrl = `https://slack.com/api/conversations.history?channel=${channelId}&limit=200`;
  if (oldestTs !== '0') apiUrl += `&oldest=${oldestTs}`;

  const resp = UrlFetchApp.fetch(apiUrl, options);
  const json = JSON.parse(resp.getContentText());
  if (!json.ok) {
    console.error(`Slack API error: ${json.error}`);
    return;
  }
  const messages = (json.messages || []).reverse();
  if (messages.length === 0) return;

  const firstTrunc = Math.floor(parseFloat(messages[0].ts) * 100) / 100;
  if (messages.length === 1 && firstTrunc === oldestTrunc) return;

  const userCache: Record<string, { name: string; avatar: string }> = {};
  let channelName = channelId;
  try {
    const infoResp = UrlFetchApp.fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, options);
    const infoJson = JSON.parse(infoResp.getContentText());
    if (infoJson.ok && infoJson.channel) {
      channelName = infoJson.channel.name || channelId;
    }
  } catch (e: unknown) {
    console.error('チャンネル情報取得失敗:', e instanceof Error ? e.message : String(e));
  }

  const rows: any[][] = [];
  for (const msg of messages) {
    if (msg.subtype === 'channel_join' || msg.subtype === 'channel_leave') continue;
    if (typeof msg.text === 'string' && msg.text.indexOf(notificationMarker) !== -1) continue; // 自身の通知はスキップ
    const msgTrunc = Math.floor(parseFloat(msg.ts) * 100) / 100;
    if (msgTrunc === oldestTrunc) continue;

    const uid = msg.user;
    let name = 'Unknown User';
    let avatar = '';
    if (uid) {
      if (!userCache[uid]) {
        try {
          Utilities.sleep(1200); // Rate limit 対策
          const userResp = UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${uid}`, options);
          const userJson = JSON.parse(userResp.getContentText());
          if (userJson.ok && userJson.user) {
            name = userJson.user.real_name || userJson.user.name;
            avatar = userJson.user.profile?.image_48 || '';
            userCache[uid] = { name, avatar };
          }
        } catch (e: unknown) {
          console.error('ユーザー情報取得失敗:', e instanceof Error ? e.message : String(e));
        }
      } else {
        name = userCache[uid].name;
        avatar = userCache[uid].avatar;
      }
    }

    let permalink = '';
    try {
      Utilities.sleep(1200); // Rate limit 対策
      const plResp = UrlFetchApp.fetch(
        `https://slack.com/api/chat.getPermalink?channel=${channelId}&message_ts=${msg.ts}`,
        options
      );
      const plJson = JSON.parse(plResp.getContentText());
      if (plJson.ok) permalink = plJson.permalink;
    } catch (e: unknown) {
      console.error('パーマリンク取得失敗:', e instanceof Error ? e.message : String(e));
    }

    rows.push([msg.ts, uid || '', name, avatar, msg.text || '', channelId, channelName, permalink]);
  }

  if (rows.length > 0) {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  }
}

// ---- 統合データ＆検索 ----

function getContent(): ContentItem[] {
  const articles = getArticles();
  const slackMessages = getSlackMessages();

  const formattedArticles: ContentItem[] = articles.map((article) => ({
    type: 'article',
    id: article.id,
    title: article.title,
    content: article.content,
    timestamp: new Date(article.updatedAt || article.createdAt).getTime() / 1000,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    tags: article.tags || [],
    author: { email: article.authorEmail, name: article.authorName || guessNameFromEmail(article.authorEmail) },
  }));

  const formattedSlack: ContentItem[] = slackMessages.map((msg) => ({
    type: 'slack',
    id: msg.id,
    title: '',
    content: msg.text,
    timestamp: parseFloat(msg.timestamp),
    createdAt: new Date(parseFloat(msg.timestamp) * 1000).toISOString(),
    updatedAt: null,
    tags: ['slack', `channel:${msg.channel.name}`],
    author: { name: msg.user.name, avatar: msg.user.avatar },
    channel: msg.channel,
    link: msg.link,
  }));

  const combined = [...formattedArticles, ...formattedSlack];
  combined.sort((a, b) => b.timestamp - a.timestamp);
  return combined;
}

function searchContent(query: string): ContentItem[] {
  const q = (query || '').toLowerCase();
  if (!q) return getContent();

  const all = getContent();
  return all.filter((item) => {
    if (item.type === 'article') {
      const textMatch =
        item.title.toLowerCase().includes(q) ||
        item.content.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.author.email.toLowerCase().includes(q) ||
        (item.author.name || '').toLowerCase().includes(q);
      return textMatch;
    }
    const slackText =
      item.content.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q)) ||
      item.author.name.toLowerCase().includes(q) ||
      (item.channel?.name || '').toLowerCase().includes(q);
    return slackText;
  });
}

// ---- 画像アップロード ----

function uploadImageToDrive(originalFileName: string, mimeType: string, base64Data: string): UploadResult {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const spreadsheetFile = DriveApp.getFileById(ss.getId());
    const parents = spreadsheetFile.getParents();
    const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

    const folderName = CONFIG.drive.imagesFolderName || 'notehub-images';
    let folder: GoogleAppsScript.Drive.Folder;
    const existing = parentFolder.getFoldersByName(folderName);
    folder = existing.hasNext() ? existing.next() : parentFolder.createFolder(folderName);

    const decoded = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decoded, mimeType);

    const now = new Date();
    const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const nameParts = originalFileName.split('.');
    const ext = nameParts.length > 1 ? `.${nameParts.pop()}` : '';
    const baseName = nameParts.join('.') || 'image';
    const newName = `${timestamp}_${baseName}${ext}`;

    const file = folder.createFile(blob.setName(newName));

    // Some Google Workspace settings reject DOMAIN_WITH_LINK; fall back to ANYONE_WITH_LINK
    // to avoid "invalid argument: permission.value" when the domain share scope is unavailable.
    let sharingApplied = false;
    try {
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      sharingApplied = true;
    } catch (shareErr) {
      Logger.log(
        `DOMAIN_WITH_LINK での共有設定に失敗: ${
          shareErr instanceof Error ? shareErr.message : String(shareErr)
        }`
      );
    }

    if (!sharingApplied) {
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        sharingApplied = true;
      } catch (shareErr) {
        const msg = shareErr instanceof Error ? shareErr.message : String(shareErr);
        Logger.log(`ANYONE_WITH_LINK での共有設定にも失敗: ${msg}`);
        return { success: false, error: `ファイル共有の設定に失敗しました: ${msg}` };
      }
    }

    return {
      success: true,
      fileId: file.getId(),
      fileName: newName,
      filePath: `${folder.getName()}/${newName}`,
      fileUrl: `https://lh3.googleusercontent.com/d/${file.getId()}`,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    Logger.log(`Google Driveへの画像アップロード中にエラー: ${msg}`);
    return { success: false, error: `ファイルのアップロードに失敗しました: ${msg}` };
  }
}

// 新規投稿をSlack通知（通知チャンネルが設定されている場合のみ）
function notifySlackNewArticle(payload: { id: string; title: string; author: string }) {
  const token = CONFIG.slack.botToken;
  const targets = CONFIG.slack.notificationChannelIds || [];
  if (!token || targets.length === 0) return;

  const marker = '[NoteHubNotify]';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = 'https://slack.com/api/chat.postMessage';

  const link = buildArticleLink(payload.id);
  const text = link
    ? `${marker} 新規投稿: <${link}|${payload.title}> by ${payload.author}`
    : `${marker} 新規投稿: ${payload.title} by ${payload.author}`;

  for (const channel of targets) {
    try {
      const body = {
        channel,
        text,
      };
      UrlFetchApp.fetch(url, {
        method: 'post',
        headers,
        contentType: 'application/json',
        payload: JSON.stringify(body),
        muteHttpExceptions: true,
      });
    } catch (e: unknown) {
      console.error('Slack通知に失敗:', e instanceof Error ? e.message : String(e));
    }
  }
}

/**
 * デプロイ後の簡易スモークテスト。
 * - シートを整備
 * - ダミー記事を1件追加→削除
 * - getArticles / getContent が安全に動くか確認
 * - Slack設定があれば syncSlackMessages を試行
 * 実データを壊さないよう、タイトルに [SMOKE] を含むものだけ削除対象にする。
 */
function smokeTest() {
  const results: Record<string, any> = {};

  try {
    results.ensure = ensureSheetStructure();
  } catch (e: unknown) {
    results.ensure = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  const dummyTitle = `[SMOKE] ping ${new Date().toISOString()}`;
  try {
    addArticle({ title: dummyTitle, content: 'smoke test', tagsString: 'smoke' });
    results.added = dummyTitle;
  } catch (e: unknown) {
    results.added = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const articles = getArticles();
    results.articleCount = articles.length;
    const dummy = articles.find((a) => a.title === dummyTitle);
    results.foundDummy = !!dummy;
    if (dummy) {
      results.delete = deleteArticle(dummy.id);
    } else {
      results.delete = 'skip (not found)';
    }
  } catch (e: unknown) {
    results.articleOps = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const content = getContent();
    results.contentCount = content.length;
  } catch (e: unknown) {
    results.content = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (CONFIG.slack.botToken && CONFIG.slack.channelIds.length > 0) {
    try {
      syncSlackMessages();
      results.slackSync = 'ok';
    } catch (e: unknown) {
      results.slackSync = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    results.slackSync = 'skip (no slack config)';
  }

  Logger.log(JSON.stringify(results));
  return results;
}

// 呼び出し名をわかりやすくするためのエイリアス
function integrationTest() {
  return smokeTest();
}

// エディタ上で並びやすいように実行用のラッパーを番号プレフィックス付きで公開
function f00_initSheets() {
  return initSheets();
}

function f01_integrationTest() {
  return integrationTest();
}

function f02_syncSlackMessages() {
  if (!CONFIG.slack.botToken || CONFIG.slack.channelIds.length === 0) {
    return 'skip (no slack config)';
  }
  syncSlackMessages();
  return 'ok';
}

// ---- エクスポート ----
// GAS 側で呼び出せるように global に公開する。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
g.getConfig = getConfig;
g.doGet = doGet;
g.include = include;
g.getUserEmail = getUserEmail;
g.ensureSheetStructure = ensureSheetStructure;
g.initSheets = initSheets;
g.getArticles = getArticles;
g.addArticle = addArticle;
g.getArticleById = getArticleById;
g.updateArticle = updateArticle;
g.deleteArticle = deleteArticle;
g.getSlackMessages = getSlackMessages;
g.syncSlackMessages = syncSlackMessages;
g.getContent = getContent;
g.searchContent = searchContent;
g.uploadImageToDrive = uploadImageToDrive;
g.smokeTest = smokeTest;
g.integrationTest = integrationTest;
g.f00_initSheets = f00_initSheets;
g.f01_integrationTest = f01_integrationTest;
g.f02_syncSlackMessages = f02_syncSlackMessages;
