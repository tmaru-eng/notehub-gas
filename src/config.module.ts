/**
 * テスト用: モジュールとして import 可能な getConfig を提供。
 * 本番コードは src/config.ts（グローバル）を使用。
 */
import { ScriptProperties } from './types.module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const GENERATED_CONFIG: any | undefined;

export type SlackConfig = {
  botToken: string;
  channelIds: string[];
  notificationChannelIds: string[];
  botTokenPropertyKey: string;
  channelIdsPropertyKey: string;
  notificationChannelIdsPropertyKey: string;
};

export type AppConfig = {
  spreadsheetId: string;
  sheets: {
    articles: string;
    slackMessages: string;
  };
  drive: {
    imagesFolderName: string;
  };
  slack: SlackConfig;
  webAppUrl?: string;
};

const DEFAULT_CONFIG: AppConfig = {
  spreadsheetId: '',
  sheets: {
    articles: 'Articles',
    slackMessages: 'SlackMessages',
  },
  drive: {
    imagesFolderName: 'notehub-images',
  },
  slack: {
    botToken: '',
    channelIds: [],
    notificationChannelIds: [],
    botTokenPropertyKey: 'SLACK_BOT_TOKEN',
    channelIdsPropertyKey: 'SLACK_CHANNEL_IDS',
    notificationChannelIdsPropertyKey: 'SLACK_NOTIFICATION_CHANNEL_IDS',
  },
  webAppUrl: '',
};

const BASE_CONFIG: AppConfig = typeof GENERATED_CONFIG !== 'undefined' ? GENERATED_CONFIG : DEFAULT_CONFIG;

export function getConfig(props: ScriptProperties): AppConfig {
  const spreadsheetId = extractId(props.getProperty('SPREADSHEET_ID') || BASE_CONFIG.spreadsheetId);
  const articlesSheet = props.getProperty('ARTICLES_SHEET_NAME') || BASE_CONFIG.sheets.articles;
  const slackSheet = props.getProperty('SLACK_SHEET_NAME') || BASE_CONFIG.sheets.slackMessages;
  const imagesFolder = props.getProperty('DRIVE_IMAGES_FOLDER') || BASE_CONFIG.drive.imagesFolderName;

  const slackBotToken = sanitizePlaceholder(
    props.getProperty(BASE_CONFIG.slack.botTokenPropertyKey) || BASE_CONFIG.slack.botToken
  ) as string;
  const slackChannelsRaw = sanitizePlaceholder(
    props.getProperty(BASE_CONFIG.slack.channelIdsPropertyKey) || BASE_CONFIG.slack.channelIds
  );
  const slackChannelIds = normalizeChannelIds(slackChannelsRaw);
  const slackNotifyRaw = sanitizePlaceholder(
    props.getProperty(BASE_CONFIG.slack.notificationChannelIdsPropertyKey) ||
      BASE_CONFIG.slack.notificationChannelIds
  );
  const slackNotifyChannelIds = normalizeChannelIds(slackNotifyRaw);

  return {
    spreadsheetId,
    sheets: {
      articles: articlesSheet,
      slackMessages: slackSheet,
    },
    drive: {
      imagesFolderName: imagesFolder,
    },
    slack: {
      botToken: slackBotToken,
      channelIds: slackChannelIds,
      botTokenPropertyKey: BASE_CONFIG.slack.botTokenPropertyKey,
      channelIdsPropertyKey: BASE_CONFIG.slack.channelIdsPropertyKey,
      notificationChannelIds: slackNotifyChannelIds,
      notificationChannelIdsPropertyKey: BASE_CONFIG.slack.notificationChannelIdsPropertyKey,
    },
    webAppUrl: BASE_CONFIG.webAppUrl,
  };
}

function normalizeChannelIds(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter(Boolean).map((s) => s.trim());
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// 雛形文字列（PUT_...）が入っている場合は未設定扱いにする
function sanitizePlaceholder(value: string | string[]): string | string[] {
  if (Array.isArray(value)) {
    return value.filter((v) => !isPlaceholder(v));
  }
  return isPlaceholder(value) ? '' : value;
}

function isPlaceholder(v: string | undefined): boolean {
  if (!v) return false;
  return v.startsWith('PUT_') || v.includes('YOUR_SLACK') || v.includes('COMMA_SEPARATED');
}

// Accepts either a raw ID or a full URL that contains the ID and returns the ID portion.
function extractId(raw: string | null): string {
  if (!raw) return '';
  const value = raw.trim();
  const spreadsheetMatch = value.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (spreadsheetMatch) return spreadsheetMatch[1];
  const scriptMatch = value.match(/script\.google\.com\/(?:d\/|macros\/s\/|home\/projects\/)([a-zA-Z0-9-_]+)/);
  if (scriptMatch) return scriptMatch[1];
  return value;
}
