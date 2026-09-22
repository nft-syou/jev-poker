# jev-poker

[![CI](https://github.com/nft-syou/jev-poker/actions/workflows/ci.yml/badge.svg)](https://github.com/nft-syou/jev-poker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/node-24-339933?logo=nodedotjs&logoColor=white)](.node-version)
[![pnpm](https://img.shields.io/badge/pnpm-12-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Deploys to Cloudflare Pages](https://img.shields.io/badge/deploys%20to-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](#cloudflare-pages-へデプロイ)

**English version: [README.md](README.md)**

ブラウザで遊べるノーリミット・テキサスホールデム。CPU プレイヤーは全員
[TypeSafe Jev](https://typesafe.ai) で考えます。人間 1 人 + CPU、または全席 CPU の
観戦モード。プレイにはあなた自身の TypeSafe API キー、または Vercel AI Gateway /
ロリポップ！AIゲートウェイ / Cloudflare AI Gateway の設定が必要です。

## 仕組み

1. ゲームエンジン (`src/engine`、依存ゼロ) が配札・ベッティング・サイドポット・役判定を行う。
2. CPU の手番ごとに `src/jev` が状況を圧縮し (ポジション、完成役、ドロー、正確なハンド強度とエクイティ、ポットオッズ、BB 換算スタック、今ハンドのアクション)、Jev に 3 つの型付き質問を 1 回で投げる: `action` (合法な選択肢からの choice)、`sizing` (0〜5 の score)、`bluff_intent` (yes/no の確率)。
3. Jev は確率を返す。人格の「ぶれ」で argmax かサンプリングかが決まり、最後に合法なベット額にクランプされる。
4. Jev に届かない場合は check か fold にし、履歴にその理由が出る。

認証情報はブラウザの localStorage にだけ保存され、このサイトの `/api/jev/*`
プロキシ (Cloudflare Pages Function) 経由の送信にのみ使われます。プロキシは
`Authorization: Bearer <key>` に載せ替えて転送し、何も保存しません。

## 遊ぶ

1. デプロイ済みのサイトを開く (または下記の手順でローカルで起動する)。
2. 求められたら経路を選び、その認証情報を入力する (後述)。ブラウザにのみ保存されます。
3. 席数 (2〜6)、人間の席、各 CPU の人格、ブラインド、スタックを決める。人間の席が無ければ観戦モードになります。
4. ハンド履歴の「Jev」を開くと、各 CPU のアクションの裏にある確率が見られます。

## 経路

接続モーダルで 4 つの経路から 1 つを選びます。ヘッダのボタンからいつでも変更できます。

| 経路 | 用意するもの | リクエストの宛先 | モデル | 課金 |
| --- | --- | --- | --- | --- |
| TypeSafe 直結 | TypeSafe API キー | `https://api.typesafe.ai` | `jev-latest` | TypeSafe |
| Vercel AI Gateway | Vercel AI Gateway の API キー | `https://ai-gateway.vercel.sh/typesafe` | `typesafe-ai/jev` | Vercel (自分の TypeSafe キーを登録していればそちら) |
| ロリポップ！AIゲートウェイ | ロリポップ！AIゲートウェイの API キー | `https://ai-gateway.lolipop.jp` | `typesafe/jev-latest` | ロリポップ (円建ての前払いクレジット) |
| Cloudflare AI Gateway | TypeSafe API キー + アカウント ID、ゲートウェイ ID、カスタムプロバイダの slug、任意でゲートウェイトークン | `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-{slug}` | `jev-latest` | TypeSafe (Cloudflare はログ・キャッシュ・レート制限を担当) |

### Vercel AI Gateway

1. Vercel ダッシュボード → AI Gateway → **API keys** → キーを作成する (`vck_…`)。
2. それを AI Gateway API キーとして貼り付ける。他に必要なものはありません。ゲートウェイは `https://ai-gateway.vercel.sh/typesafe` で TypeSafe API を話し、アプリはモデル id `typesafe-ai/jev` を指定します。
3. 任意の BYOK: ゲートウェイのプロバイダ設定に自分の TypeSafe キーを登録すると、Vercel がそのキーで転送し、課金は TypeSafe 側になります。

### ロリポップ！AIゲートウェイ

1. [ai-gateway.lolipop.jp](https://ai-gateway.lolipop.jp/) → プロジェクト → **API キー** でキーを発行し、そのプロジェクトが `typesafe/jev-latest` を呼べることを確認する。
2. それをロリポップ！AIゲートウェイの API キーとして貼り付ける。他に必要なものはありません。ゲートウェイは TypeSafe と同じ `POST /v1/systemone` ([型付き確率的判断](https://ai-gateway.lolipop.jp/docs/guides/features/probabilistic-decision)) を提供しており、アプリはモデル id `typesafe/jev-latest` を指定します。
3. 課金は組織の前払いクレジットです。残高が尽きると 402 が返り、テーブルは一時停止してチャージを促します。

### Cloudflare AI Gateway

1. Cloudflare ダッシュボード → AI → **AI Gateway** → ゲートウェイを作成する。**ゲートウェイ ID** と **アカウント ID** (ダッシュボードの URL にある 16 進数 32 文字) を控える。
2. そのゲートウェイにベース URL `https://api.typesafe.ai` の **カスタムプロバイダ** を追加し、slug (例: `typesafe`) を付ける。リクエスト URL は `…/custom-typesafe/v1/systemone` になります。`custom-` はアプリが付けるので、slug だけを貼り付けてください。
3. jev-poker で「Cloudflare AI Gateway」を選び、TypeSafe API キー、アカウント ID、ゲートウェイ ID、slug を入力する。
4. ゲートウェイが **認証付き** なら、ゲートウェイトークンを作成して「ゲートウェイトークン」に貼り付ける。`cf-aig-authorization` として送られます。

### セキュリティ

プロキシは自由な URL を一切受け取りません。経路 id (`typesafe`、`vercel`、`lolipop`、`cloudflare`)
で固定の 4 ホストから選び、サーバー側で先頭・末尾を固定した正規表現を通った値だけを
`encodeURIComponent` して埋め込みます。アカウント ID は `[0-9a-f]{32}`、ゲートウェイ ID は
`[A-Za-z0-9_-]{1,64}`、プロバイダの slug は `[a-z0-9][a-z0-9-]{0,62}` かつ `custom-` 始まりでないこと、
キーとトークンは印字可能な ASCII 512 文字までです。条件を満たさなければ 400 を返し、上流には接続しません。
転送するのは `POST /v1/systemone` と `GET /v1/models` だけで、上流へのヘッダはゼロから組み立てる
(アプリ自身の `X-*` ヘッダは一切通さない) ため、サーバーに保存・ログは一切ありません。
脆弱性の報告は [SECURITY.md](SECURITY.md) を参照してください。

## ローカルで動かす

Node.js 24 と pnpm が必要です。

    pnpm install
    pnpm dev          # Vite の開発サーバー。/api/jev は Pages Function と同じプロキシハンドラで動く
    pnpm dev:pages    # ビルド + `wrangler pages dev dist` で本物の Pages Function を動かす
    pnpm check        # lint + 型チェック + テスト + ビルド

`pnpm dev:pages` には `wrangler` が必要です (dev dependency として入るので追加インストールは不要)。
`.node-version` は、それを読むツール向けに Node 24 を固定しています。

## Cloudflare Pages へデプロイ

1. このリポジトリを GitHub にフォークまたはプッシュする。
2. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → リポジトリを接続する。
3. ビルドコマンド `pnpm build`、出力ディレクトリ `dist`。環境変数 `NODE_VERSION=24` を設定する。
4. `functions/` の Functions は自動でデプロイされます。シークレットは不要です。プレイヤーが自分の認証情報を持ち込みます。

任意の環境変数 `TYPESAFE_BASE_URL` は `typesafe` 経路の上流 API ルートだけを上書きします
(ゲートウェイのホストはコード内の定数です)。`https://…` (ローカル作業なら `http://localhost…`)
の形のときだけ使われ、それ以外は既定値に戻ります。

## 人格

5 つのプリセット (ロック、TAG、LAG、マニアック、コーリングステーション) があります。
複製して、Jev に渡す説明文と「ぶれ」を編集できます。カスタム人格はブラウザの localStorage に保存されます。

## ベンチマーク

`pnpm bench` はゲーム本体の Jev CPU を 3 種のベースライン (`random`、`caller`、ルールベースの `rules`) と
対戦させ、bb/100 と 95% 信頼区間を出します。同じ配牌を Jev の席だけ入れ替えて再生する (ミラーハンド) ので
カード運の分散が小さく、ヘッズアップと 6-max の両方を測ります。`pnpm bench:slumbot` は本格的な
ヘッズアップ AI の [Slumbot](https://www.slumbot.com/) と公開 API 経由で対戦します。

    TYPESAFE_API_KEY=... pnpm bench --opponent rules --format all --seeds 1000
    pnpm bench --backend mock --seeds 100     # ドライラン。キー不要、費用ゼロ
    pnpm bench:report                         # 保存済みの結果を再描画

計測結果 (`tag` 人格、調整に使っていない 1,000 シード):

| 相手 | ヘッズアップ bb/100 | 6-max bb/100 |
| --- | --- | --- |
| `rules` ボット | **+48.8** [+38.4, +59.1] | **+11.3** [-0.2, +22.8] |
| Slumbot (200 bb、12,000 ハンド) | -49.4 [-65.8, -33.0] | — |

`rules` の行は現在出荷している CPU そのものです。Slumbot の行はエージェントをゲームのエンジンに移植する前の計測で、
その時点では同じエージェントが `rules` に対して +62.7 [+48.7, +76.8] / +12.9 [+1.3, +24.5] でした。

- このゲームが最初に積んでいた CPU はルールベースに勝てていませんでした (HU -4.5、6-max -24.5)。
  同じ配牌での直接比較で、現在の CPU は **+53.2 [+31.5, +75.0]** / **+35.8 [+9.9, +61.7]** bb/100 上回ります。
  勝てるようになったのは「Jev に何を伝えるか」
  (正確なハンド強度、エクイティと必要エクイティ、自分のベットがレイズされたか、ポットコミット、
  スティールの機会) と標準的なプリフロップのレイズ額のおかげで、強さはモデルの周りのコードから来ています。
- 同じ特徴量だけを読む固定ルールは、ヘッズアップで Jev より 30〜50 bb/100 弱く、6-max では互角です。
  Slumbot には Jev もヒューリスティックもルールベースも約 50 bb/100 負けます。
- Jev の価値はキャラクターの作りやすさにあります。人格は一段落の文章で、すべての判断に見せられる確率が付き、
  新しいキャラクターを増やすのにコードは要りません。

詳細: [`bench/README.md`](bench/README.md) (CLI、結果の形式)、
[`bench/RESULTS.md`](bench/RESULTS.md) (全表)、
[`bench/EXPERIMENTS.md`](bench/EXPERIMENTS.md) (試したすべての変更とその計測)。

## 構成

    src/engine/    依存ゼロの TypeScript ポーカーエンジン (シード付きランダムプレイでテスト)
    src/jev/       特徴量、質問、人格、判断方針、接続 + TypeSafe バックエンド
    src/agents/    `Agent` インターフェース: ベースラインボット、ヒューリスティック、エージェントとしての Jev CPU
    src/ui/        React UI、ゲームループ、Jev の確率付き履歴
    src/i18n/      en / ja 辞書
    src/proxy/     プロキシハンドラと開発サーバー用アダプタ (ユニットテスト済み)
    functions/     Cloudflare Pages Function のエントリ
    bench/         ベンチマークランナー、統計、Slumbot クライアント、保存済み結果
    docs/superpowers/specs/  設計書

## 今後

- トーナメント形式: `BlindSchedule` がブラインドを抽象化済み。`format` が `tournament` のときは飛んだ席をリバイしない。
- 質問セットのバージョンを各判断に記録する。

## コントリビュート

バグ報告、機能要望、プルリクエストを歓迎します。ビルドとテストの方法は
[CONTRIBUTING.md](CONTRIBUTING.md)、行動規範は [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、
変更履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください (いずれも英語)。

## ライセンス

MIT — [`LICENSE`](LICENSE) を参照。
