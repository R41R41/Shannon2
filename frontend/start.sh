#!/bin/bash

# スクリーンセッション名を定義
FRONTEND_SESSION="shannon-frontend"

# 既存のセッションを確認・終了
screen -X -S $FRONTEND_SESSION quit > /dev/null 2>&1

# テストモードフラグをチェック
IS_TEST=false
if [ "$1" = "--test" ]; then
    IS_TEST=true
    echo "Starting frontend in test mode..."
fi

# フロントエンドを起動
if [ "$IS_TEST" = true ]; then
    screen -dmS $FRONTEND_SESSION bash -c 'npm run dev:test'
else
    screen -dmS $FRONTEND_SESSION bash -c 'npm run dev'
fi
echo "Frontend started in screen session: $FRONTEND_SESSION"

# セッション情報を表示
echo -e "\nActive screen sessions:"
screen -ls

echo -e "\nTo attach to the session:"
echo "  screen -r $FRONTEND_SESSION" 