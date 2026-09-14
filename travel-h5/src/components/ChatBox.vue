<template>
  <div class="chat-bubble" :class="messageClass">
    <div class="bubble-content">
      <div v-if="message.role !== 'user'" class="message-text markdown-body" v-html="renderedContent"></div>
      <div class="message-text" v-else>{{ message.content }}</div>
    </div>
    <div class="message-time" v-if="showTime">{{ formatTime }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const messageClass = computed(() => {
  return props.message.role === 'user' ? 'user-message' : 'ai-message'
})
const markdown = new MarkdownIt({ breaks: true, linkify: true })
const renderedContent = computed(() => DOMPurify.sanitize(markdown.render(props.message.content || '')))

const showTime = computed(() => {
  return props.message.timestamp && props.message.content
})

const formatTime = computed(() => {
  if (!props.message.timestamp) return ''
  const date = new Date(props.message.timestamp)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
})
</script>

<style scoped>
.chat-bubble {
  display: flex;
  flex-direction: column;
  max-width: 70%;
  margin-bottom: 16px;
}

.user-message {
  align-self: flex-end;
  align-items: flex-end;
}

.ai-message {
  align-self: flex-start;
  align-items: flex-start;
}

.bubble-content {
  padding: 12px 16px;
  border-radius: 4px 14px 14px 14px;
  border: 1px solid var(--line);
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
}

.user-message .bubble-content {
  background-color: var(--olive-700);
  border-color: var(--olive-700);
  color: var(--paper);
  border-radius: 14px 4px 14px 14px;
}

.ai-message .bubble-content {
  background-color: var(--paper);
  color: var(--ink);
  border-bottom-left-radius: 4px;
  box-shadow: var(--card-shadow);
}

.markdown-body :deep(p) { margin: 0 0 8px; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 6px 0; padding-left: 20px; }
.markdown-body :deep(a) { color: var(--orange-600); text-decoration: underline; }
.markdown-body :deep(code) { padding: 2px 4px; border-radius: 3px; background: var(--sand-200); color: var(--olive-800); }
.markdown-body :deep(pre) { overflow-x: auto; padding: 8px; border-radius: 6px; background: var(--sand-100); }

.message-time {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}

.user-message .message-time {
  text-align: right;
  padding-right: 8px;
}

.ai-message .message-time {
  text-align: left;
  padding-left: 8px;
}
</style>
