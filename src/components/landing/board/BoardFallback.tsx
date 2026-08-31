import { BoardPreview } from '../BoardPreview'

/**
 * What stands in when the 3D board cannot run.
 *
 * It is the flat board that used to be the hero's only visual — kept for
 * exactly this, and shown when WebGL is unavailable, when the GLB fails to
 * load, or when the scene throws. A hero with a hole in it is worse than a hero
 * with the old picture in it, and this one is already animated: it plays the
 * product's lifecycle on a loop whether or not a GPU is involved.
 */
export function BoardFallback() {
  return <BoardPreview />
}
