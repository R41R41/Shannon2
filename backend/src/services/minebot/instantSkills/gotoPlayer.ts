import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
import ChangeDimension from './changeDimension.js';
import SearchAndGotoEntity from './searchAndGotoEntity.js';
const { goals } = pathfinder;

class GotoPlayer extends InstantSkill {
    private changeDimension: ChangeDimension;
    private searchAndGotoEntity: SearchAndGotoEntity;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'goto-player';
        this.description =
            '指定されたプレイヤーの元に向かって移動します。';
        this.status = false;
        this.params = [
            {
                name: 'PlayerDimension',
                description: 'プレイヤーがいるディメンション。例: overworld, the_nether, the_end',
                type: 'string',
                required: false,
                default: null,
            },
            {
                name: 'playerCoordinate',
                description: 'プレイヤーの座標。',
                type: 'Vec3',
                required: true,
            },
            {
                name: 'playerName',
                description: 'プレイヤーの名前。',
                type: 'string',
                required: true,
            },
        ];
        this.changeDimension = new ChangeDimension(bot);
        this.searchAndGotoEntity = new SearchAndGotoEntity(bot);
    }

    async runImpl(playerDimension: string, playerCoordinate: Vec3, playerName: string) {
        if (playerDimension) {
            const result = await this.changeDimension.run(playerDimension);
            if (!result.success) {
                return result;
            }
        }
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('移動タイムアウト')), 30 * 1000);
        });
        const movePromise = this.bot.pathfinder.goto(new goals.GoalNear(playerCoordinate.x, playerCoordinate.y, playerCoordinate.z, 10));
        await Promise.race([movePromise, timeoutPromise]);
        const result = await this.searchAndGotoEntity.run(playerName);
        if (!result.success) {
            return result;
        }
        return {
            success: true,
            result: `プレイヤー ${playerName} に移動しました`,
        };
    }
}

export default GotoPlayer;
