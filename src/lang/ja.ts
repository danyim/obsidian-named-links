/**
 * Japanese strings. The ones Auto Link Title also had are taken from
 * yuu1111/obsidian-auto-link-title's translation.
 */
import type { Strings } from './en';

const ja: Strings = {
  commands: {
    pasteWithTitle: 'URLを貼り付けてタイトルを自動取得',
    pasteWithoutTitle: '通常の貼り付け（タイトル取得なし）',
    enhance: '既存のURLにリンクとタイトルを追加',
  },
  notices: {
    offline: 'インターネット接続がありません。タイトルを取得できません。',
    noTitle: (host: string) => `${host} のタイトルを取得できませんでした。`,
    noUrlHere: 'タイトルを追加できるURLがありません。',
    noUrlInSelection: '選択範囲にURLがありません。',
    imported: (from: string) => `${from} から設定をインポートしました。`,
    importFailed: (reason: string) => `インポートに失敗しました。${reason}`,
    importInvalidJson: (from: string) =>
      `${from} の設定ファイルが正しいJSONではありません。`,
    importEmpty: (from: string) => `${from} の設定ファイルに設定がありません。`,
  },
  placeholder: 'タイトル取得中…',
  settings: {
    conflict: {
      name: (other: string) => `${other} も有効になっています`,
      desc: (other: string) =>
        `どちらのプラグインも貼り付けたURLを処理し、先に動いた方が優先されます。移行が済んだらコミュニティプラグインで ${other} を無効にしてください。`,
    },
    import: {
      name: (from: string) => `${from} からインポート`,
      desc: (from: string) =>
        `このVaultに ${from} の設定が見つかりました。こちらにコピーできます。`,
      button: 'インポート',
      confirm: (from: string) =>
        `現在の設定を ${from} が保存した設定で置き換えます。元に戻すことはできません。`,
      cancel: 'キャンセル',
    },
    whenHeading: 'タイトルを取得するタイミング',
    enhancePaste: {
      name: 'デフォルト貼り付けを拡張',
      desc: 'デフォルトの貼り付けコマンドでリンクを貼り付ける際にリンクタイトルを取得する。Ctrl/Cmd+Shift+V で貼り付けた場合はURLをそのまま貼り付けます。',
    },
    enhanceDrop: {
      name: 'ドロップイベントを拡張',
      desc: '他のプログラムからリンクをドラッグ＆ドロップする際にリンクタイトルを取得する',
    },
    useSelectionAsTitle: {
      name: '選択テキストをタイトルとして保持',
      desc: '選択したテキストの上にURLを貼り付けた場合、タイトルを取得せずにそのテキストをリンクにする',
    },
    skipCodeAndFrontmatter: {
      name: 'コードとフロントマターを無視',
      desc: 'コードブロック、インラインコード、フロントマター内に貼り付けたURLはそのままにする',
    },
    titlesHeading: 'タイトル',
    removeSiteName: {
      name: 'サイト名を除去',
      desc: '「Video - YouTube」や「GitHub - owner/repo」のように、タイトルの先頭または末尾にあるサイト名を取り除く。',
    },
    titleRules: {
      name: 'タイトルの置換ルール',
      desc: '取得したすべてのタイトルに検索と置換を適用します。1行に1つ、「パターン => 置換後」の形式で書きます。/パターン/フラグ と書くと正規表現になり、置換後で $1 を使えます。# で始まる行は無視されます。',
      problem: (line: number, reason: string) => `${line}行目: ${reason}`,
      missingArrow: 'パターンと置換後の間に => がありません。',
      emptyPattern: 'パターンが空です。',
      invalidRegex: (message: string) =>
        `正規表現が正しくありません（${message}）。`,
    },
    maxTitleLength: {
      name: 'タイトルの最大文字数',
      desc: 'これより長いタイトルを短くします。0で無効化。',
    },
    twitterProxy: {
      name: 'X の投稿を FxTwitter 経由で取得',
      desc: 'X はJavaScriptなしではタイトルを返しません。有効にすると、twitter.com と x.com のリンクを第三者サービスの fxtwitter.com または fixupx.com 経由で取得します。そのサービスにURLが送信されます。',
    },
    excludedHeading: '除外するサイト',
    excludedSites: {
      name: 'サイト',
      desc: 'これらのタイトルは取得しません。example.com のようなドメインはサブドメインも対象になり、それ以外はその文字列を含むURLが対象になります。1行に1つ、またはカンマ区切り。',
    },
    excludedSiteFormat: {
      name: '除外したサイトの貼り付け方法',
      url: 'URLをそのまま',
      domain: 'ドメイン名をタイトルにしたリンク',
    },
  },
};

export default ja;
