import { Vec3 } from 'vec3';
import { CustomBot, Param } from '../types.js';
import { getChatResponse } from './getChatResponse.js';

export async function getParams(
  bot: CustomBot,
  data: Record<string, any>,
  params: Param[],
  args: string[]
) {
  const result: Record<string, any> = {};
  if (data == null) {
    for (const param of params) {
      let response: string;
      if (args.length > 0) {
        response = args[0];
        args.shift();
      } else {
        response = await getChatResponse(
          bot,
          `${param.name}: ${param.type}の値を教えてください`
        );
      }
      if (response == '.') {
        bot.chat('キャンセルしました');
        return { success: false, result: 'キャンセル' };
      }
      if (response == 'default') {
        result[param.name] = param.default;
      } else {
        const parsedValue = convertType(response, param.type);
        console.log('parsedValue:', parsedValue);
        if (parsedValue !== null && parsedValue.error) {
          bot.chat('here:' + parsedValue.result);
          return { success: false, result: parsedValue.result };
        }
        result[param.name] = parsedValue;
      }
    }
    return result;
  }
  if (data.length == 0) {
    return { error: true, result: 'data is empty' };
  }
  for (const param of params) {
    if (data[param.name]) {
      const parsedValue = convertType(data[param.name], param.type);
      if (parsedValue !== null && parsedValue.error) {
        bot.chat(parsedValue.result?.toString() ?? 'null');
        return { error: true, result: parsedValue.result };
      }
      result[param.name] = parsedValue;
    } else {
      result[param.name] = param.default;
    }
  }
  return result;
}

/**
 * 指定された型に変換する関数
 * @param {string} value
 * @param {string} type
 * @returns {any}
 */
function convertType(
  value: string,
  type: string
): { error: boolean; result: number | boolean | Vec3 | string | null } {
  if (value == null || value === 'null' || value === 'none') {
    return { error: true, result: null };
  }
  switch (type) {
    case 'number':
      const parsedNumber = parseFloat(value);
      if (isNaN(parsedNumber)) {
        return { error: true, result: `${value}は無効な${type}です` };
      }
      return { error: false, result: parsedNumber };
    case 'boolean':
      const boolStr = String(value).toLowerCase();
      if (boolStr === 'true') {
        return { error: false, result: true };
      } else if (boolStr === 'false') {
        return { error: false, result: false };
      } else {
        return { error: true, result: `${value}は無効な${type}です` };
      }
    case 'string':
      return { error: false, result: String(value) };
    case 'vec3':
      const vec3 = String(value).split(',');
      return {
        error: false,
        result: new Vec3(Number(vec3[0]), Number(vec3[1]), Number(vec3[2])),
      };
    default:
      return { error: false, result: value };
  }
}
