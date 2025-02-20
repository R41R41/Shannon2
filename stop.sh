#!/bin/bash

# スクリーンセッション名を定義
FRONTEND_SESSION="shannon-frontend"
BACKEND_SESSION="shannon-backend"

# 既存のセッションを確認・終了
screen -X -S $FRONTEND_SESSION quit > /dev/null 2>&1
screen -X -S $BACKEND_SESSION quit > /dev/null 2>&1

# セッション一覧を表示
echo -e "\nActive screen sessions:"
screen -ls