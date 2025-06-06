import { CustomBot, InstantSkill } from '../types.js';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;

class RideVehicle extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'ride-vehicle';
        this.description = 'ボートやトロッコなどの乗り物に乗る/降りるスキルです。entityNameで乗り物名を指定、isDismount=trueで降ります。';
        this.params = [
            {
                name: 'entityName',
                type: 'string',
                description: '乗る乗り物のエンティティ名（例: oak_boat, acacia_boat, minecart, minecart_chest など）',
                default: 'oak_boat',
            },
            {
                name: 'isDismount',
                type: 'boolean',
                description: 'trueで降りる、falseで乗る',
                default: false,
            },
        ];
    }

    async runImpl(entityName: string = 'oak_boat', isDismount: boolean = false) {
        try {
            if (isDismount) {
                await this.bot.dismount();
                return { success: true, result: '乗り物から降りました。' };
            }
            // 乗る場合
            const entities = Object.values(this.bot.entities)
                .filter(e => e.name && e.name.includes(entityName))
                .sort((a, b) => this.bot.entity.position.distanceTo(a.position) - this.bot.entity.position.distanceTo(b.position));
            if (entities.length === 0) {
                return { success: false, result: `近くに${entityName}が見つかりません。` };
            }
            const vehicle = entities[0];
            // 近づく
            await this.bot.pathfinder.goto(
                new goals.GoalNear(vehicle.position.x, vehicle.position.y, vehicle.position.z, 2)
            );
            // 乗る
            await this.bot.mount(vehicle);
            return { success: true, result: `${entityName}に乗りました。` };
        } catch (error: any) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

export default RideVehicle; 