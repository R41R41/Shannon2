#!/bin/bash

# スクリーンセッション名を定義
BACKEND_SESSION="shannon-backend"

# 既存のセッションを確認・終了
screen -X -S $BACKEND_SESSION quit > /dev/null 2>&1

# テストモードフラグをチェック
IS_TEST=false
if [ "$1" = "--test" ]; then
    IS_TEST=true
    echo "Starting backend in test mode..."
fi

# バックエンドを起動
if [ "$IS_TEST" = true ]; then
    screen -dmS $BACKEND_SESSION bash -c 'npm run dev:test'
else
    screen -dmS $BACKEND_SESSION bash -c 'npm run dev'
fi
echo "Backend started in screen session: $BACKEND_SESSION"

# セッション情報を表示
echo -e "\nActive screen sessions:"
screen -ls

echo -e "\nTo attach to the session:"
echo "  screen -r $BACKEND_SESSION" 