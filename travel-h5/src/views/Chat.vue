<template>
  <van-nav-bar
    title="AI旅游助手"
    left-text="返回"
    left-arrow
    @click-left="onClickLeft"
    fixed
    safe-area-inset-top
  />
  <div class="chat-container" ref="chatContainer">
    <div v-if="messages.length === 0" class="no-messages">
      <van-empty description="开始和AI助手对话" />
      <div class="quick-questions">
        <div class="quick-title">
          <van-icon name="question-o" />
          <span>猜你想问</span>
        </div>
        <div class="tag-list">
          <van-tag
            v-for="q in quickQuestions"
            :key="q"
            size="large"
            plain
            round
            class="question-tag"
            @click="handleQuestion(q)"
          >
            {{ q }}
          </van-tag>
        </div>
      </div>
      
    </div>
    <div v-else class="message-list">
         <ChatBox v-for="msg in messages" :key="msg.id" :message="msg" />
         <div class="streaming-indicator" v-if="isStreaming">
            <van-loading type="spinner" size="20px" color="var(--olive-700)" />
            <span>{{ agentStage || 'AI正在思考中...' }}</span>
         </div>
      </div>
  </div>
  <!-- 底部输入框区域 -->
  <div class="chat-input-area">
    <van-field
      v-model="inputMessage"
      placeholder="请输入您的问题"
      :disabled="isStreaming"
      @keyup.enter="sendMessage"
    >
      <template #button>
        <van-button type="primary" size="small" :disabled="!inputMessage.trim()" @click="sendMessage">
          发送
        </van-button>
      </template>
    </van-field>
  </div>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'
import { ref,onMounted } from 'vue'
import { showToast } from 'vant'
import { fetchStream } from '../utils/request'
import { getChatSessionById, saveChatSession } from '../utils/travelStorage'
import ChatBox from '../components/ChatBox.vue'
import { useTravelStore } from '../stores/travel'

const router = useRouter()
const route = useRoute()
const chatContainer = ref(null)
//创建置底的方法
const scrollToBottom = ()=>{
    if(chatContainer.value){
        chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
}
//会话数据
const sessionId = ref(route.query.sessionId || `${Date.now()}`)
const messages = ref([])
const inputMessage = ref('')
const isStreaming = ref(false)
const travelStore = useTravelStore()
const agentStage = ref('')

const persistSession = () => {
  saveChatSession({
    id: sessionId.value,
    title: messages.value.find((item) => item.role === 'user')?.content?.slice(0, 18) || 'AI对话',
    messages: messages.value,
  })
}

const addUserMessage = (content) => {
  messages.value.push({
    id: Date.now(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  })
  travelStore.messages = messages.value
  persistSession()
}

const onClickLeft = () => {
  router.back()
}

const quickQuestions = ref([
  '北京有哪些好玩的景点',
  '上海美食推荐',
  '成都三日游',
  '学生票怎么买',
])

const handleQuestion = (question) => {
  inputMessage.value = question
}

const sendMessage = () => {
  //先做去空处理
  const msg =inputMessage.value.trim()
  //做校验
  if(!msg || isStreaming.value){
    return
  }
  addUserMessage(msg)
  //清空输入框
  inputMessage.value = ''
  //进行流式请求
  fetchAIResponse(msg)

}
//获取AI响应
const fetchAIResponse =(userMsg)=>{
    isStreaming.value = true
    messages.value.push({
        id:Date.now()+1,
        role:'ai',
        content:'',
        timestamp:new Date().toISOString()
    })
    persistSession()
    let fullResponse = ''
    fetchStream('chat',{message:userMsg},(chunk)=>{
        fullResponse += chunk
        const lastMsg = messages.value[messages.value.length-1]
        //分片处理逻辑
        if(lastMsg && lastMsg.role === 'ai'){
            lastMsg.content = fullResponse
        }
        travelStore.messages = messages.value
        scrollToBottom()
    },()=>{
       //ai返回完成
       isStreaming.value = false
       persistSession()
       scrollToBottom()
    },(errMsg)=>{
        //异常状态处理
        const lastMsg = messages.value[messages.value.length-1]
        if(lastMsg && lastMsg.role === 'ai'){
            lastMsg.content = `抱歉，AI发生了错误：${errMsg}`
        }
        isStreaming.value = false
        persistSession()
        showToast('AI处理失败，请稍后重试')
        scrollToBottom()
    }, (event) => {
      if (event.type === 'stage') agentStage.value = event.label || event.stage
    })
}
onMounted(()=>{
    const session = route.query.sessionId ? getChatSessionById(route.query.sessionId) : null
    if (session && Array.isArray(session.messages)) {
      messages.value = session.messages
      travelStore.setSession(sessionId.value, messages.value)
      inputMessage.value = ''
      scrollToBottom()
      return
    }
    if (route.query.prompt) {
       inputMessage.value = route.query.prompt
    } else if(route.query.city){
       inputMessage.value = `我计划去${route.query.city}，预算${route.query.budget}，计划${route.query.days}天`
    }
})
</script>

<style scoped>
.chat-container {
  min-height: 100vh;
  padding-top: calc(46px + env(safe-area-inset-top));
  padding-bottom: 110px;
  background-color: transparent;
}

.no-messages {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
}

.empty-illustration {
  margin-bottom: 20px;
}

.empty-icon {
  font-size: 80px;
  color: var(--olive-500);
  opacity: 0.6;
}

.quick-questions {
  width: 100%;
  margin-top: 20px;
}

.quick-title {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--olive-800);
}

.quick-title van-icon {
  margin-right: 6px;
  font-size: 16px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}

.question-tag {
  cursor: pointer;
  transition: all 0.3s;
}

.question-tag:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 10px rgba(102, 115, 75, 0.2);
}

.message-list {
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.chat-input-area {
  position: fixed;
  bottom: calc(50px + env(safe-area-inset-bottom));
  left: 0;
  right: 0;
  background-color: rgba(255, 250, 241, 0.96);
  border-top: 1px solid var(--line);
  padding: 10px 16px;
  box-sizing: border-box;
  z-index: 100;
}

.chat-input-area :deep(.van-field) {
  background-color: var(--sand-100);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 16px;
}

.chat-input-area :deep(.van-button) { border-radius: 6px; }
</style>
