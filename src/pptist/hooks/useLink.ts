import { useSlidesStore } from '@ppt/store'
import type { PPTElement, PPTElementLink } from '@ppt/types/slides'
import useHistorySnapshot from '@ppt/hooks/useHistorySnapshot'
import message from '@ppt/utils/message'

export default () => {
  const slidesStore = useSlidesStore()

  const { addHistorySnapshot } = useHistorySnapshot()

  const setLink = (handleElement: PPTElement, link: PPTElementLink) => {
    const linkRegExp = /^(https?):\/\/[\w\-]+(\.[\w\-]+)+([\w\-.,@?^=%&:\/~+#]*[\w\-@?^=%&\/~+#])?$/
    if (link.type === 'web' && !linkRegExp.test(link.target)) {
      message.error('不是正确的网页链接地址')
      return false
    }
    if (link.type === 'slide' && !link.target) {
      message.error('请先选择链接目标')
      return false
    }
    const props = { link }
    slidesStore.updateElement({ id: handleElement.id, props })
    addHistorySnapshot()

    return true
  }

  const removeLink = (handleElement: PPTElement) => {
    slidesStore.removeElementProps({ id: handleElement.id, propName: 'link' })
    addHistorySnapshot()
  }

  return {
    setLink,
    removeLink,
  }
}