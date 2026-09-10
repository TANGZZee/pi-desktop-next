/** 桌宠模型清单 —— 模型来自公开 Live2D 模型库（GitHub + jsDelivr CDN），可自由增删条目。 */
export type PetModel = {
  id: string
  name: string
  description: string
  /** "owner/repo" */
  repo: string
  branch: string
  /** 模型目录路径（相对仓库根，未编码） */
  dir: string
  /** 模型入口文件名（model3.json 为 Cubism 3/4，model.json 为 Cubism 2） */
  modelFile: string
  /** 预览图路径（相对 dir） */
  preview: string
}

export const PETS: readonly PetModel[] = [
  {
    id: 'haru',
    name: 'Haru',
    description: 'Live2D 官方示例 · 元气少女',
    repo: 'guansss/pixi-live2d-display',
    branch: 'master',
    dir: 'test/assets/haru',
    modelFile: 'haru_greeter_t03.model3.json',
    preview: 'haru_greeter_t03.2048/texture_00.png'
  },
  {
    id: 'shizuku',
    name: 'Shizuku',
    description: 'Live2D 官方示例 · 猫耳娘',
    repo: 'guansss/pixi-live2d-display',
    branch: 'master',
    dir: 'test/assets/shizuku',
    modelFile: 'shizuku.model.json',
    preview: 'shizuku.1024/texture_00.png'
  },
  {
    id: 'c000_01',
    name: '天命之子 c000_01',
    description: 'Destiny Child · 角色立绘',
    repo: 'Eikanya/Live2d-model',
    branch: 'master',
    dir: 'destiny_child_kr 天命之子/c000_01',
    modelFile: 'model.json',
    preview: 'textures/texture_00.png'
  },
  {
    id: 'c000_10',
    name: '天命之子 c000_10',
    description: 'Destiny Child · 角色立绘',
    repo: 'Eikanya/Live2d-model',
    branch: 'master',
    dir: 'destiny_child_kr 天命之子/c000_10',
    modelFile: 'model.json',
    preview: 'textures/texture_00.png'
  }
]

function jsdelivr(repo: string, branch: string, path: string) {
  const encoded = path.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  return `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${encoded}`
}

export function petModelUrl(pet: PetModel) {
  return jsdelivr(pet.repo, pet.branch, `${pet.dir}/${pet.modelFile}`)
}

export function petPreviewUrl(pet: PetModel) {
  return jsdelivr(pet.repo, pet.branch, `${pet.dir}/${pet.preview}`)
}

export function petById(id: string): PetModel | undefined {
  return PETS.find((pet) => pet.id === id)
}
