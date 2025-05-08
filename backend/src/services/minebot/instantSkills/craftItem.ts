import { InstantSkill, CustomBot } from "../types.js";
import { goals } from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';

class CraftItem extends InstantSkill{
    private mcData: any;
    constructor(bot: CustomBot){
        super(bot);
        this.skillName = "craft-item";
        this.description = "指定されたアイテムを作成する";
        this.status = false;
        this.mcData = minecraftData(this.bot.version);
        this.params = [
            {
                "name": "itemName",
                "description": "作成するアイテム",
                "type": "string"
            },{
                "name": "amount",
                "description": "作成するアイテムの数量",
                "type": "number"
            }
        ];
    }

    async run(itemName: string, amount: number){
        console.log("craftItem", itemName);
        try{
            const item = this.mcData.itemsByName[itemName];
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!item) {
                return {"success": false, "result": `アイテム ${itemName} が見つかりませんでした`};
            }
            const recipe = this.bot.recipesFor(item.id,null,null,true)[0];
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!recipe) {
                return {"success": false, "result": `アイテム ${itemName} のレシピが見つかりませんでした`};
            }
            if (recipe.requiresTable) {
                const craftingTable = this.bot.findBlock({
                    matching: this.mcData.blocksByName.crafting_table.id,
                    maxDistance: 64
                });
                if (!craftingTable) {
                    return {"success": false, "result": "近くに作業台が見つかりませんでした"};
                }
                await this.bot.pathfinder.goto(new goals.GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3));
                await this.bot.craft(recipe, amount, craftingTable);
            }else{  
                await this.bot.craft(recipe, amount, undefined);
            }
            const items = this.bot.inventory.items().filter(item => item.name === itemName);
            if (items && items.length >= amount){
                return {"success": true, "result": `${itemName}を${amount}個作成しました`};
            }
            return {"success": false, "result": `${itemName}を作成できませんでした`};
        } catch (error: any) {
            return {"success": false, "result": `${error.message} in ${error.stack}`};
        }
    }
}

export default CraftItem;