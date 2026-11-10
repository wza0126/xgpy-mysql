@echo off
rem 双远端推送（Gitee 主 + GitHub 备份）
rem 用法：scripts\push.cmd            推两个远端
rem       scripts\push.cmd --no-backup 只推 Gitee
rem       scripts\push.cmd --force     工作区有未提交改动也照推
node "%~dp0push-all.js" %*
