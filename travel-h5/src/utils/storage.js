const STORAGE_KEYS = {
  PLANS: 'travel_plans',
  CHAT_HISTORY: 'chat_history'
}

export const storage = {
  getPlans() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PLANS)
      return data ? JSON.parse(data) : []
    } catch {
      return []
    }
  },

  savePlan(plan) {
    try {
      const plans = this.getPlans()
      const newPlan = {
        id: Date.now(),
        ...plan,
        createdAt: new Date().toISOString()
      }
      plans.unshift(newPlan)
      localStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(plans))
      return newPlan
    } catch (error) {
      console.error('保存规划失败:', error)
      return null
    }
  },

  deletePlan(id) {
    try {
      const plans = this.getPlans().filter(p => p.id !== id)
      localStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(plans))
    } catch (error) {
      console.error('删除规划失败:', error)
    }
  },

  getChatHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY)
      return data ? JSON.parse(data) : []
    } catch {
      return []
    }
  },

  saveChat(sessionId, messages) {
    try {
      const history = this.getChatHistory()
      const existingIndex = history.findIndex(h => h.id === sessionId)
      
      const session = {
        id: sessionId,
        title: messages[0]?.content || '未命名对话',
        messages: [...messages],
        updatedAt: new Date().toISOString()
      }
      
      if (existingIndex >= 0) {
        history[existingIndex] = session
      } else {
        history.unshift(session)
      }
      
      localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(history))
      return session
    } catch (error) {
      console.error('保存对话失败:', error)
      return null
    }
  },

  getChatSession(sessionId) {
    try {
      const history = this.getChatHistory()
      return history.find(h => h.id === sessionId) || null
    } catch {
      return null
    }
  },

  deleteChat(sessionId) {
    try {
      const history = this.getChatHistory().filter(h => h.id !== sessionId)
      localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(history))
    } catch (error) {
      console.error('删除对话失败:', error)
    }
  }
}
