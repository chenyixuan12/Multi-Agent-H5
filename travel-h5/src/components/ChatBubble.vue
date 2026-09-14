<template>
  <div class="chat-bubble">
    <div class="bubble-content">
      <div class="bubble-icon">
        温馨提示
      </div>
      <div class="bubble-text" >
         <div v-for="(note, index) in notes" :key="index" class="note-item">
          <span class="note-number">{{ index + 1 }}.</span>
          <span class="note-content">{{ note }}</span>
        </div>
      </div>
    </div>
    <div class="bubble-arrow"></div>
  </div>
</template>

<script setup>
import { Icon } from 'vant'

const props = defineProps({
  notes: {
    type: Array,
    required: true
  }
})


</script>

<style scoped>
.chat-bubble {
  position: relative;
  background-color: #fff7e5;
  border-radius: 4px;
  margin-bottom: 16px;
  overflow: hidden;
  border: 1px solid #e8c99a;
  box-shadow: 2px 3px 0 rgba(118, 91, 48, 0.07), 0 8px 18px rgba(74, 62, 43, 0.07);
}

.bubble-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background-color: #f8ead0;
  border-bottom: 1px solid #e8c99a;
}

.bubble-header van-icon {
  color: var(--orange-600);
  font-size: 16px;
  margin-right: 8px;
}

.bubble-header span {
  font-size: 14px;
  font-weight: 600;
  color: var(--orange-600);
}

.bubble-content {
  padding: 16px;
}

.note-item {
  display: flex;
  margin-bottom: 12px;
  align-items: flex-start;
}

.note-item:last-child {
  margin-bottom: 0;
}

.note-dot {
  width: 6px;
  height: 6px;
  background-color: var(--orange-500);
  border-radius: 50%;
  margin-right: 10px;
  margin-top: 6px;
  flex-shrink: 0;
}

.note-content {
  font-size: 14px;
  color: var(--olive-800);
  line-height: 1.6;
}
</style>
