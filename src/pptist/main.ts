import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import 'prosemirror-view/style/prosemirror.css'
import 'animate.css'
import '@ppt/assets/styles/prosemirror.scss'
import '@ppt/assets/styles/global.scss'
import '@ppt/assets/styles/font.scss'

import Directive from '@ppt/directive'

const app = createApp(App)
app.use(Directive)
app.use(createPinia())
app.mount('#app')
