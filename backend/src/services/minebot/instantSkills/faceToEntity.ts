import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';
export class FaceToEntity extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'face-to-entity';
    this.description = '視線を指定されたエンティティに向けます。';
    this.params = [
      {
        name: 'entityName',
        type: 'string',
        description:
          'エンティティの名前。例: zombie, creeper, R41R41(ユーザー名)など',
        default: null,
      },
    ];
  }
  async runImpl(entityName: string) {
    try {
      const entity = this.bot.utils.getNearestEntitiesByName(
        this.bot,
        entityName
      )[0];
      // エンティティの頭の位置を取得
      const entityHeadPosition = new Vec3(
        entity.position.x,
        entity.position.y + entity.height,
        entity.position.z
      );
      await this.bot.lookAt(entityHeadPosition);
      return {
        success: true,
        result: '視線を指定されたエンティティに向けました',
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default FaceToEntity;
