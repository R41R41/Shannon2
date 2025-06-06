import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';
import pathfinder from 'mineflayer-pathfinder';
const { goals, Movements } = pathfinder;
import ShootItemToEntityOrBlockOrCoordinate from './shootItemToEntityOrBlockOrCoordinate.js';

class ShootingGame extends InstantSkill {
    private shootItemToEntityOrBlockOrCoordinate: ShootItemToEntityOrBlockOrCoordinate;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'shootingGame';
        this.description =
            'シューティングゲームを実行します。';
        this.priority = 50;
        this.params = [
            {
                name: 'coordinate',
                type: 'Vec3',
                description:
                    'シューティングゲームの座標を指定します。',
                default: null,
            },
            {
                name: 'targetCoordinate',
                type: 'Vec3',
                description:
                    'シューティングゲームで狙う座標を指定します。',
                default: null,
            }
        ];
        this.shootItemToEntityOrBlockOrCoordinate = new ShootItemToEntityOrBlockOrCoordinate(bot);
    }

    async runImpl(coordinate: Vec3, targetCoordinate: Vec3) {
        const goal = new goals.GoalNear(
            coordinate.x,
            coordinate.y,
            coordinate.z,
            1
        );
        await this.bot.pathfinder.goto(goal);
        let count = 0;
        const maxCount = 1;
        while (true) {
            const result = await this.shootItemToEntityOrBlockOrCoordinate.shootToCoordinate(targetCoordinate, null);
            console.log(result.result);
            await new Promise(resolve => setTimeout(resolve, 5000));
            count++;
            if (count > maxCount) {
                break;
            }
        }
        return { success: true, result: 'シューティングゲームを実行しました' };
    }
}

export default ShootingGame;
