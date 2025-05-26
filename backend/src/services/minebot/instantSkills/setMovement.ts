import { InstantSkill, CustomBot } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals, Movements } = pathfinder;
import { Bot } from 'mineflayer';

class SetMovement extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'set-movement';
        this.description =
            'canDig,digCost,allowSprinting,allow1by1towers,allowParkour,canOpenDoors,dontMineUnderFallingBlockなどbotの移動の仕方を設定します。';
        this.status = false;
        this.params = [
            {
                name: 'canDig',
                type: 'boolean',
                description: 'ボットが掘ることができるかどうかを設定します。',
                default: true,
            },
            {
                name: 'digCost',
                type: 'number',
                description: 'ボットが掘るコストを設定します。',
                default: 1,
            },
            {
                name: 'allowSprinting',
                type: 'boolean',
                description: 'ボットが走ることができるかどうかを設定します。',
                default: true,
            },
            {
                name: 'allow1by1towers',
                type: 'boolean',
                description: 'ボットが1ブロックずつ上ることができるかどうかを設定します。',
                default: true,
            },
            {
                name: 'allowParkour',
                type: 'boolean',
                description: 'ボットがパルクールをすることができるかどうかを設定します。',
                default: true,
            },
            {
                name: 'canOpenDoors',
                type: 'boolean',
                description: 'ボットがドアを開けることができるかどうかを設定します。',
                default: true,
            },
            {
                name: 'dontMineUnderFallingBlock',
                type: 'boolean',
                description: 'ボットが落下ブロックを掘ることができるかどうかを設定します。',
                default: true,
            }
        ];
    }

    async run(canDig: boolean, digCost: number, allowSprinting: boolean, allow1by1towers: boolean, allowParkour: boolean, canOpenDoors: boolean, dontMineUnderFallingBlock: boolean) {
        const defaultMove = new Movements(this.bot as unknown as Bot);
        defaultMove.canDig = canDig;
        defaultMove.digCost = digCost;
        defaultMove.allow1by1towers = allow1by1towers;
        defaultMove.allowSprinting = allowSprinting;
        defaultMove.allowParkour = allowParkour;
        defaultMove.canOpenDoors = canOpenDoors;
        defaultMove.dontMineUnderFallingBlock = dontMineUnderFallingBlock;

        // 移動設定を適用
        this.bot.pathfinder.setMovements(defaultMove);
        return {
            success: true,
            result: 'ボットの移動の仕方を設定しました。',
        };
    }
}

export default SetMovement;
