import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTravelStore = defineStore('travel', () => {
  const activeSessionId = ref(null)
  const messages = ref([])
  const currentPlan = ref(null)
  const planningStage = ref('')

  const setSession = (id, items = []) => {
    activeSessionId.value = id
    messages.value = items
  }
  const setPlan = (plan) => { currentPlan.value = plan }
  const setStage = (stage) => { planningStage.value = stage }

  return { activeSessionId, messages, currentPlan, planningStage, setSession, setPlan, setStage }
})
