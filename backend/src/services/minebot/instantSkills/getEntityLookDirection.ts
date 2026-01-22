import { CustomBot, InstantSkill } from '../types.js';

/**
 * エンティティ（プレイヤー等）の向きと位置を取得するスキル
 * 「あの〜」と指示された時に、ユーザーが見ている方向を確認するために使用
 */
class GetEntityLookDirection extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'get-entity-look-direction';
        this.description =
            'プレイヤーやエンティティの位置と向き（視線方向）を取得します。ユーザーが「あの〜」と何かを指している時に、ユーザーの視線方向を確認するために使用します。';
        this.params = [
            {
                name: 'entityName',
                type: 'string',
                description: 'エンティティの名前（プレイヤー名など）',
                required: true,
            },
        ];
    }

    async runImpl(entityName: string) {
        try {
            if (!entityName) {
                return {
                    success: false,
                    result: 'エンティティ名を指定してください',
                };
            }

            let entity = null;
            let resolvedName = entityName;

            // "player" が指定された場合は最も近いプレイヤーを探す
            if (entityName.toLowerCase() === 'player') {
                const nearestPlayer = this.findNearestPlayer();
                if (nearestPlayer) {
                    entity = nearestPlayer.entity;
                    resolvedName = nearestPlayer.name;
                }
            } else {
                // まず指定された名前でプレイヤーを検索
                const player = this.bot.players[entityName];
                if (player && player.entity) {
                    entity = player.entity;
                }

                // プレイヤーが見つからなければ、その他のエンティティを検索
                if (!entity) {
                    entity = Object.values(this.bot.entities).find((e) => {
                        const name = e.username || e.name || '';
                        return name.toLowerCase() === entityName.toLowerCase();
                    });
                }
            }

            if (!entity) {
                // 利用可能なプレイヤー名を表示
                const availablePlayers = Object.keys(this.bot.players)
                    .filter(name => name !== this.bot.username && this.bot.players[name].entity)
                    .join(', ');

                return {
                    success: false,
                    result: `エンティティ「${entityName}」が見つかりません。${availablePlayers ? `利用可能なプレイヤー: ${availablePlayers}` : '近くにプレイヤーがいません'}`,
                };
            }

            // 以降、resolvedNameを使用
            entityName = resolvedName;

            // 位置
            const pos = entity.position;

            // 向き（yaw, pitch）
            // Minecraft: yaw は水平方向（南=0, 西=90, 北=180, 東=-90）
            // pitch は上下方向（-90=真上, 0=水平, 90=真下）
            const yaw = entity.yaw || 0;
            const pitch = entity.pitch || 0;

            // yawから方角を計算
            const yawDegrees = (yaw * 180) / Math.PI;
            const direction = this.getDirectionName(yawDegrees);

            // 視線の先の座標を計算（10ブロック先）
            const lookDistance = 10;
            const lookX = pos.x - Math.sin(yaw) * Math.cos(pitch) * lookDistance;
            const lookY = pos.y + entity.height - Math.sin(pitch) * lookDistance;
            const lookZ = pos.z + Math.cos(yaw) * Math.cos(pitch) * lookDistance;

            // ユーザーの横に立つための座標を計算（右側2ブロック）
            const sideOffset = 2;
            const sideX = pos.x - Math.sin(yaw + Math.PI / 2) * sideOffset;
            const sideZ = pos.z + Math.cos(yaw + Math.PI / 2) * sideOffset;

            const resultYaw = Math.round(yawDegrees * 10) / 10;
            const resultPitch = Math.round((pitch * 180) / Math.PI * 10) / 10;
            const moveToX = Math.round(sideX * 10) / 10;
            const moveToY = Math.round(pos.y * 10) / 10;
            const moveToZ = Math.round(sideZ * 10) / 10;

            // 次のアクションを明確に指示
            const nextActions = [
                `1. move-to: {"x":${moveToX},"y":${moveToY},"z":${moveToZ}} で${entityName}の横に移動`,
                `2. look-at: {"yaw":${resultYaw},"pitch":${resultPitch}} で${entityName}と同じ方向を向く`,
                `3. describe-bot-view で${entityName}が見ているものを確認`,
            ];

            return {
                success: true,
                result: `${entityName}は${direction}方向を向いています。\n\n【次のアクション】\n${nextActions.join('\n')}\n\n【詳細】\n- ${entityName}の位置: (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})\n- 向き: yaw=${resultYaw}°, pitch=${resultPitch}°\n- 移動先座標: (${moveToX}, ${moveToY}, ${moveToZ})`,
            };
        } catch (error: any) {
            return {
                success: false,
                result: `エラー: ${error.message}`,
            };
        }
    }

    /**
     * 最も近いプレイヤーを探す（自分以外）
     */
    private findNearestPlayer(): { entity: any; name: string } | null {
        let nearestPlayer = null;
        let nearestDistance = Infinity;

        for (const [name, player] of Object.entries(this.bot.players)) {
            // 自分自身は除外
            if (name === this.bot.username) continue;

            // エンティティが存在するプレイヤーのみ
            if (!player.entity) continue;

            const distance = this.bot.entity.position.distanceTo(player.entity.position);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestPlayer = { entity: player.entity, name };
            }
        }

        return nearestPlayer;
    }

    /**
     * yaw角度から方角名を取得
     */
    private getDirectionName(yawDegrees: number): string {
        // yawを0-360に正規化
        const normalized = ((yawDegrees % 360) + 360) % 360;

        if (normalized >= 337.5 || normalized < 22.5) return '南';
        if (normalized >= 22.5 && normalized < 67.5) return '南西';
        if (normalized >= 67.5 && normalized < 112.5) return '西';
        if (normalized >= 112.5 && normalized < 157.5) return '北西';
        if (normalized >= 157.5 && normalized < 202.5) return '北';
        if (normalized >= 202.5 && normalized < 247.5) return '北東';
        if (normalized >= 247.5 && normalized < 292.5) return '東';
        if (normalized >= 292.5 && normalized < 337.5) return '南東';
        return '不明';
    }
}

export default GetEntityLookDirection;

