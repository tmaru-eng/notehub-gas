// テスト専用に module として扱うため、type-onlyファイルとは別に共通関数を定義
import { getConfig } from '../src/config.module';

class MockProps {
  constructor(private data: Record<string, string> = {}) {}
  getProperty(key: string) {
    return this.data[key] ?? null;
  }
}

describe('getConfig', () => {
  test('merges properties, supports comma-separated channel IDs', () => {
    const props = new MockProps({
      SPREADSHEET_ID: 'sheet123',
      ARTICLES_SHEET_NAME: 'Art',
      SLACK_SHEET_NAME: 'Slack',
      DRIVE_IMAGES_FOLDER: 'folder',
      SLACK_BOT_TOKEN: 'xoxb-123',
      SLACK_CHANNEL_IDS: 'C1 , C2,,',
    });
    const cfg = getConfig(props);
    expect(cfg.spreadsheetId).toBe('sheet123');
    expect(cfg.sheets.articles).toBe('Art');
    expect(cfg.sheets.slackMessages).toBe('Slack');
    expect(cfg.drive.imagesFolderName).toBe('folder');
    expect(cfg.slack.botToken).toBe('xoxb-123');
    expect(cfg.slack.channelIds).toEqual(['C1', 'C2']);
  });

  test('falls back to defaults when properties are missing', () => {
    const props = new MockProps();
    const cfg = getConfig(props);
    expect(cfg.spreadsheetId).toBe('');
    expect(cfg.sheets.articles).toBe('Articles');
    expect(cfg.slack.channelIds).toEqual([]);
  });

  test('treats placeholders as empty for slack settings', () => {
    const props = new MockProps({
      SLACK_BOT_TOKEN: 'PUT_YOUR_SLACK_BOT_TOKEN_HERE',
      SLACK_CHANNEL_IDS: 'PUT_COMMA_SEPARATED_CHANNEL_IDS_HERE',
      SLACK_NOTIFICATION_CHANNEL_IDS: 'PUT_COMMA_SEPARATED_NOTIFY_CHANNEL_IDS_HERE',
    });
    const cfg = getConfig(props);
    expect(cfg.slack.botToken).toBe('');
    expect(cfg.slack.channelIds).toEqual([]);
    expect(cfg.slack.notificationChannelIds).toEqual([]);
  });

  test('parses notification channel IDs separately from ingest channels', () => {
    const props = new MockProps({
      SLACK_CHANNEL_IDS: 'C01, C02',
      SLACK_NOTIFICATION_CHANNEL_IDS: 'N01 ,N02,,',
    });
    const cfg = getConfig(props);
    expect(cfg.slack.channelIds).toEqual(['C01', 'C02']);
    expect(cfg.slack.notificationChannelIds).toEqual(['N01', 'N02']);
  });

  test('extracts spreadsheet ID even when a URL is provided', () => {
    const props = new MockProps({
      SPREADSHEET_ID: 'https://docs.google.com/spreadsheets/d/abc123-def456/edit#gid=0',
    });
    const cfg = getConfig(props);
    expect(cfg.spreadsheetId).toBe('abc123-def456');
  });
});
