// このファイルの型はモジュール化せず、GAS のグローバル名前空間に置く。

// Script Properties の最小インターフェース
interface ScriptProperties {
  getProperty(key: string): string | null;
}

// 記事データ
type ArticleRecord = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  authorEmail: string;
  authorName: string;
};

// Slackメッセージのシート読み込み用
type SlackMessageRecord = {
  timestamp: string;
  user: {
    id: string;
    name: string;
    avatar: string;
  };
  text: string;
  channel: {
    id: string;
    name: string;
  };
  link: string;
  id: string;
};

// フロント側に返す統合コンテンツ
type ContentItem =
  | {
      type: 'article';
      id: string;
      title: string;
      content: string;
      timestamp: number;
      createdAt: string;
      updatedAt: string;
      tags: string[];
      author: { email: string; name: string };
    }
  | {
      type: 'slack';
      id: string;
      title: '';
      content: string;
      timestamp: number;
      createdAt: string;
      updatedAt: null;
      tags: string[];
      author: { name: string; avatar: string };
      channel: { id: string; name: string };
      link: string;
    };

type UploadResult =
  | { success: true; fileId: string; fileName: string; filePath: string; fileUrl: string }
  | { success: false; error: string };
