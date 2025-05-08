import HoldItem from './holdItem.js';
import { CustomBot, InstantSkill } from '../types.js';
import { Entity } from 'prismarine-entity';

// 独自の型定義を追加
type WeaponType = 'bow' | 'crossbow';

class AttackEntity extends InstantSkill {
    private entities: Entity[];
    private entities_length: number;
    private holdItem: HoldItem;
    private isLocked: boolean;
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = "attack-entity";
        this.description = "指定したエンティティを攻撃します。";
        this.params = [
            {
                "name": "num",
                "type": "number",
                "description": "倒すエンティティの数を指定します。nullの場合は近くの全てのエンティティを倒します。",
                "default": null
            },
            {
                "name": "entityName",
                "type": "string",
                "description": "エンティティの名前を指定します。",
                "default": null
            },
            {
                "name": "toolName",
                "type": "string",
                "description": "倒すのに使用するツールの名前を指定します。nullの場合は自動でツールを取得します。",
                "default": null
            }
        ]
        this.entities = [];
        this.entities_length = 0;
        this.holdItem = new HoldItem(this.bot);
        this.isLocked = false;
    }

    async run(num: number, entityName: string, toolName: string) {
        console.log("attackEntity:", num, entityName, toolName);
        try{
            if (toolName !== "null"){
                const response = await this.holdItem.run(toolName, "hand");
                if (!response.success) return response;
            }
            this.entities = await this.bot.utils.getNearestEntitiesByName(this.bot, entityName);
            this.entities_length = this.entities.length;
            if (num === null) num = this.entities_length;
            this.bot.on('entityHurt', (entity) => {
                if (entity.health && entity.health <= 0) {
                    num--;
                }
            });
            this.status = true;
            while (this.status && num > 0 && this.entities_length > 0) {
                const entity = this.entities[0];
                await this.attackEntityOnce(entity, toolName);
                await new Promise(resolve => setTimeout(resolve, 500));
                this.entities = await this.bot.utils.getNearestEntitiesByName(this.bot, entityName);
                this.entities_length = this.entities.length;
            }   
            this.status = false;
            if(num === 0 || this.entities_length === 0) {
                return {"success": true, "result": "エンティティをやっつけました"};
            }else{
                return {"success": true, "result": "攻撃を終了します"};
            }
        }catch(error: any){
            return {"success": false, "result": `${error.message} in ${error.stack}`};
        }
    }

    async attackEntityOnce(entity: Entity, toolName: string) {
        if (this.isLocked) return;
        this.isLocked = true;
        try{
            if (entity.name === 'creeper') {
                await this.attackCreeper(entity, toolName);
            } else if (entity.name && ['skeleton', 'stray', 'blaze', 'ghast', 'witch', 'wither_skelton', 'pillager'].includes(entity.name)) {
                await this.attackRangedEntityOnce(entity, toolName);
            } else if (entity.name && ['zombified_piglin', 'enderman'].includes(entity.name)) {
                await this.attackNormalEntityOnce(entity, toolName);
            } else {
                await this.attackNormalEntityOnce(entity, toolName);
            }
        }catch(error: any){
            console.log(error);
        }finally{
            this.isLocked = false;
        }
    }

    async attackCreeper(entity: Entity, toolName: string) {
        await this.bot.lookAt(entity.position.offset(0, entity.height * 0.85, 0));
        const distance = this.bot.entity.position.distanceTo(entity.position);
        if (toolName !== "null"){
            await this.attackNormalOnce(entity, distance, true);
        }else{
            const weaponName = await this.searchAndHoldWeapon(true);
            if (weaponName && weaponName.includes("bow")) {
                if (distance > 16) { 
                    this.bot.hawkEye.oneShot(entity, 'bow' as any);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else if (distance <= 5) {
                    await this.attackNormalOnce(entity, distance, true);
                }else{
                    await this.bot.utils.runFromEntities(this.bot, [entity], 16);
                }
            }else{
                await this.attackNormalOnce(entity, distance, true);
            }
        }
    }

    async attackRangedEntityOnce(entity: Entity, toolName: string) {
        await this.bot.lookAt(entity.position.offset(0, entity.height * 0.85, 0));
        const distance = this.bot.entity.position.distanceTo(entity.position);
        if (toolName !== "null"){
            await this.attackNormalOnce(entity, distance, false);
        }else{
            const weaponName = await this.searchAndHoldWeapon(true);
            if (weaponName && weaponName.includes("bow")) {
                if (distance > 16) { 
                    this.bot.hawkEye.oneShot(entity, (weaponName.includes('crossbow') ? 'crossbow' : 'bow') as any);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else if (distance <= 5) {
                    await this.attackNormalOnce(entity, distance, false);
                }else{
                    await this.bot.utils.runFromEntities(this.bot, [entity], 16);
                }
            }else{
                await this.attackNormalOnce(entity, distance, false);
            }
        }
    }

    /**
     * isBow === falseの場合はaxe > sword > bow > Nothingの順でツールを持っている場合に手に持つ。
     * isBow === trueの場合はbow > axe > sword > Nothingの順でツールを持っている場合に手に持つ。
     * @param {boolean} isBow
     * @returns {string}
     */
    async searchAndHoldWeapon(isBow: boolean) {
        const axe = this.bot.inventory.items().find(item => item.name.includes("axe"));
        const sword = this.bot.inventory.items().find(item => item.name.includes("sword"));
        const bow = this.bot.inventory.items().find(item => item.name.includes("bow"));
        const arrow = this.bot.inventory.items().find(item => item.name.includes("arrow"));
        const heldItem = await this.bot.utils.getHoldingItem.run("hand");
        if (isBow && bow && arrow) {
            if (!heldItem.result.includes("bow")) await this.holdItem.run(bow.name, "hand");
            return bow.name;
        }else if (isBow && axe) {
            if (!heldItem.result.includes("axe")) await this.holdItem.run(axe.name, "hand");
            return axe.name;
        }else if (isBow && sword) {
            if (!heldItem.result.includes("sword")) await this.holdItem.run(sword.name, "hand");
            return sword.name;
        }else if (!isBow && axe) {
            if (!heldItem.result.includes("axe")) await this.holdItem.run(axe.name, "hand");
            return axe.name;
        }else if (!isBow && sword) {
            if (!heldItem.result.includes("sword")) await this.holdItem.run(sword.name, "hand");
            return sword.name;
        }
        return null;
    }

    //通常の敵モブへの攻撃関数
    /**
     * @param {import('../types.js').Entity} entity
     * @param {string} toolName
     */
    async attackNormalEntityOnce(entity: Entity, toolName: string) {
        await this.bot.lookAt(entity.position.offset(0, entity.height * 0.85, 0));
        const distance = this.bot.entity.position.distanceTo(entity.position);
        if (toolName !== "null"){
            await this.attackNormalOnce(entity, distance, true);
        }else{
            const weaponName = await this.searchAndHoldWeapon(false);
            if (weaponName && weaponName.includes("bow")) {
                if (distance > 8) { 
                    this.bot.hawkEye.oneShot(entity, (weaponName.includes('crossbow') ? 'crossbow' : 'bow') as any);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else if (distance <= 5) {
                    await this.attackNormalOnce(entity, distance, true);
                }else{
                    await this.bot.utils.runFromEntities(this.bot, [entity], 8);
                }
            }else{
                await this.attackNormalOnce(entity, distance, true);
            }
        }
    }

    async attackNormalOnce(entity: Entity, distance: number, isHostileApproaching: boolean) {
        let runDistance = 1;
        let attackDistance = 3;
        let approachDistance = 4;
        if(isHostileApproaching) {
            runDistance = 3;
            attackDistance = 6;
            approachDistance = 8;
        }
        await this.bot.lookAt(entity.position.offset(0, entity.height * 0.85, 0));
        if (distance > approachDistance) {
            console.log("approach and attack hostile");
            await this.bot.utils.goalDistanceEntity.run(entity, attackDistance);
            await this.bot.attack(entity);
        }else if (distance <= runDistance) {
            console.log("run from hostile");
            await this.bot.utils.goalDistanceEntity.run(entity, -12);
        }else{
            console.log("attack hostile");
            await this.bot.attack(entity);
        }
    }
}

export default AttackEntity;
