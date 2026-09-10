/** 桌宠模型清单 —— 支持两种：Live2D 模型（GitHub 模型库）+ 精灵图（petdex.dev）。 */
export type PetType = 'live2d' | 'sprite'

export type PetModel = {
  type: PetType
  id: string
  name: string
  description: string
  /** 预览图 URL */
  preview: string
  // live2d 专用
  repo?: string
  branch?: string
  dir?: string
  modelFile?: string
  // sprite 专用
  spriteUrl?: string
  frames?: number
  frameW?: number
  frameH?: number
  duration?: number
}

function jsdelivr(repo: string, branch: string, path: string) {
  const encoded = path.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  return `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${encoded}`
}

function petdex(id: string) {
  return `https://assets.petdex.dev/pets/${id}/preview.webp`
}

export const LIVE2D_PETS: readonly PetModel[] = [
  {
    type: 'live2d',
    id: 'haru',
    name: 'Haru',
    description: 'Live2D 官方示例 · 元气少女',
    repo: 'guansss/pixi-live2d-display',
    branch: 'master',
    dir: 'test/assets/haru',
    modelFile: 'haru_greeter_t03.model3.json',
    preview: 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@master/test/assets/haru/haru_greeter_t03.2048/texture_00.png'
  },
  {
    type: 'live2d',
    id: 'shizuku',
    name: 'Shizuku',
    description: 'Live2D 官方示例 · 猫耳娘',
    repo: 'guansss/pixi-live2d-display',
    branch: 'master',
    dir: 'test/assets/shizuku',
    modelFile: 'shizuku.model.json',
    preview: 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@master/test/assets/shizuku/shizuku.1024/texture_00.png'
  },
  {
    type: 'live2d',
    id: 'c000_01',
    name: '天命之子 c000_01',
    description: 'Destiny Child · 角色立绘',
    repo: 'Eikanya/Live2d-model',
    branch: 'master',
    dir: 'destiny_child_kr 天命之子/c000_01',
    modelFile: 'model.json',
    preview: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model@master/destiny_child_kr%20%E5%A4%A9%E5%91%BD%E4%B9%8B%E5%AD%90/c000_01/textures/texture_00.png'
  },
  {
    type: 'live2d',
    id: 'c000_10',
    name: '天命之子 c000_10',
    description: 'Destiny Child · 角色立绘',
    repo: 'Eikanya/Live2d-model',
    branch: 'master',
    dir: 'destiny_child_kr 天命之子/c000_10',
    modelFile: 'model.json',
    preview: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model@master/destiny_child_kr%20%E5%A4%A9%E5%91%BD%E4%B9%8B%E5%AD%90/c000_10/textures/texture_00.png'
  }
]

/** 精灵图桌宠 —— 来自 petdex.dev（预览图即 6 帧精灵条，1152×208 = 6 × 192×208）。 */
export const SPRITE_PETS: readonly PetModel[] = [
  { type: 'sprite', id: 'boba', name: 'Boba', description: '波霸奶茶', spriteUrl: petdex('boba'), preview: petdex('boba'), frames: 6, frameW: 192, frameH: 208, duration: 820 },
  { type: 'sprite', id: 'doraemon', name: 'Doraemon', description: '哆啦A梦', spriteUrl: petdex('doraemon'), preview: petdex('doraemon'), frames: 6, frameW: 192, frameH: 208, duration: 820 },
  { type: 'sprite', id: 'shinchan', name: 'Shinchan', description: '蜡笔小新', spriteUrl: petdex('shinchan'), preview: petdex('shinchan'), frames: 6, frameW: 192, frameH: 208, duration: 820 },
  { type: 'sprite', id: 'goose-default', name: 'Goose', description: '大鹅', spriteUrl: petdex('goose-default'), preview: petdex('goose-default'), frames: 6, frameW: 192, frameH: 208, duration: 820 },
  { type: 'sprite', id: 'wangcai', name: 'Wangcai', description: '旺财小狗', spriteUrl: petdex('wangcai'), preview: petdex('wangcai'), frames: 6, frameW: 192, frameH: 208, duration: 820 },
  { type: 'sprite', id: 'usagi', name: 'Usagi', description: '兔兔', spriteUrl: petdex('usagi'), preview: petdex('usagi'), frames: 6, frameW: 192, frameH: 208, duration: 820 },
  { type: 'sprite', id: 'giratina', name: 'Giratina', description: '骑拉帝纳', spriteUrl: petdex('giratina'), preview: petdex('giratina'), frames: 6, frameW: 192, frameH: 208, duration: 820 },
  { type: 'sprite', id: 'gardevoir', name: 'Gardevoir', description: '沙奈朵', spriteUrl: petdex('gardevoir'), preview: petdex('gardevoir'), frames: 6, frameW: 192, frameH: 208, duration: 820 }
]

export const PETS: readonly PetModel[] = [...LIVE2D_PETS, ...SPRITE_PETS]

export function petById(id: string): PetModel | undefined {
  return PETS.find((pet) => pet.id === id)
}

export function petPreviewUrl(pet: PetModel) {
  return pet.preview
}

/** 渲染用 URL：live2d 返回 model3.json/model.json，sprite 返回精灵图。 */
export function petRenderUrl(pet: PetModel) {
  if (pet.type === 'sprite') return pet.spriteUrl || pet.preview
  return jsdelivr(pet.repo!, pet.branch!, `${pet.dir}/${pet.modelFile}`)
}

/** 旧的 model3.json URL 入口（Live2D 渲染用，保留兼容）。 */
export function petModelUrl(pet: PetModel) {
  return pet.type === 'sprite' ? (pet.spriteUrl || pet.preview) : jsdelivr(pet.repo!, pet.branch!, `${pet.dir}/${pet.modelFile}`)
}
