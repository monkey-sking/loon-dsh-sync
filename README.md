# loon-dsh-sync

<!-- badges:start -->
[![Last commit](https://img.shields.io/github/last-commit/monkey-sking/loon-dsh-sync?style=flat-square)](https://github.com/monkey-sking/loon-dsh-sync/commits/main) [![JavaScript](https://img.shields.io/github/languages/top/monkey-sking/loon-dsh-sync?style=flat-square)](https://github.com/monkey-sking/loon-dsh-sync/search?l=JavaScript) [![views](https://hits.sh/github.com/monkey-sking/loon-dsh-sync.svg?style=flat-square&label=views&color=0e75b6)](https://github.com/monkey-sking/loon-dsh-sync) [![Stars](https://img.shields.io/github/stars/monkey-sking/loon-dsh-sync?style=flat-square)](https://github.com/monkey-sking/loon-dsh-sync/stargazers) [![Forks](https://img.shields.io/github/forks/monkey-sking/loon-dsh-sync?style=flat-square)](https://github.com/monkey-sking/loon-dsh-sync/network/members)
<!-- badges:end -->

Loon 抓包插件：手机上的 Cookie/Token 经飞书中转，落到本机 DSH（`~/.dsh/cookie-sync/`）。
不依赖公网入口，蜂窝网络可用。

## 安装

Loon → 插件 → + → 填入：

```
https://raw.githubusercontent.com/monkey-sking/loon-dsh-sync/main/loon/feishu_sync.plugin
```

或（raw 被墙时）：

```
https://cdn.jsdelivr.net/gh/monkey-sking/loon-dsh-sync@main/loon/feishu_sync.plugin
```

安装后填三个参数：飞书 App ID / App Secret / 中转群 chat_id。

## 更新

Loon 插件页对「DSH 凭证同步」下拉刷新/重新拉取即可。仓库更新后无需局域网。

## 手动推送

Safari 打开 `https://www.bing.com/loon_trigger/push`（需 Loon 开启）。
