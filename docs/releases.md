# 维护与发布

每次推送以及 Pull Request 都会在 Windows 和 Linux 上运行测试。正式版本从 `main` 的提交发布，版本号同时记录在 `package.json` 与 `package-lock.json`。

1. 按变更范围升版本，例如 `npm version patch --no-git-tag-version`。
2. 如有面向用户的更新说明，将其放在 `docs/release-notes/v<版本号>.md`。其余版本使用 GitHub 自动生成的说明。
3. 将变更合并到 `main`，确认 CI 通过。在对应提交上打同版本标签并推送。例如刚合并的版本为 0.2.1 时，执行 `git tag -a v0.2.1 -m "GridDraft v0.2.1"` 和 `git push origin v0.2.1`。
4. Windows release 工作流会运行测试、打包 EXE 和便携 CLI、启动桌面版与 CLI 做验收。验收通过后，工作流上传所有附件、校验清单和示例图，再将草稿发布到 GitHub Releases。

如果发布过程中发生临时故障，在 Actions 里重新运行同一标签的工作流即可补齐草稿。稳定版本已经公开后，修复以新补丁版本发布，旧版下载仍可访问。

最新版有固定入口。用户可在仓库的 **Watch → Custom → Releases** 中订阅发布通知。更新时下载新版便携程序，原先保存的计划 JSON 可在新版继续打开。 [最新发布](https://github.com/Maskicruis/griddraft/releases/latest)
