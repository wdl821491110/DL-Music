'use strict';

// 必须在 require api/util/* 之前设置：这些模块在加载时就把 isLite/appid/clientver
// 固化为常量（模块顶层 const）。原 bootstrap 里设 platform='lite' 是在运行时，
// 晚于模块加载，导致取链固化成主版身份，与概念版签到领的会员体系错配，
// 概念版权益歌曲全部取链失败（领了VIP却所有音质都播不了）。
if (typeof process !== 'undefined') {
  if (!process.env) process.env = {};
  process.env.platform = 'lite';
}

const { createRequest } = require('../../../api/util/request.js');
const { calculateMid, generateWebGLHash, getGuid } = require('../../../api/util/util.js');
// qrcode 只安装在 api/node_modules 下，且其入口的图片渲染依赖 canvas/pngjs（RN 里不可用），
// 这里直接引用纯 JS 的编码核心生成点阵，由 UI 层（QrCodeView）自行渲染。
const { create: createQrSymbol } = require('../../../api/node_modules/qrcode/lib/core/qrcode.js');

function createQrMatrix(text) {
  const { modules } = createQrSymbol(text, { errorCorrectionLevel: 'M' });
  return { size: modules.size, data: modules.data };
}

module.exports = {
  createRequest,
  calculateMid,
  generateWebGLHash,
  getGuid,
  createQrMatrix,
};
