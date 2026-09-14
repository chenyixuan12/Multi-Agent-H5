const PLAN_KEY = 'travel-agent-plans'
const CHAT_KEY = 'travel-agent-chats'
const FAVORITE_KEY = 'travel-agent-favorites'

const safeParse = (value, fallback) => {
  try {
    return JSON.parse(value) ?? fallback
  } catch {
    return fallback
  }
}

const readList = (key) => {
  if (typeof window === 'undefined') return []
  return safeParse(window.localStorage.getItem(key), [])
}

const writeList = (key, list) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(list))
}

export const savePlan = (plan) => {
  const list = readList(PLAN_KEY)
  const record = {
    id: plan.id || `${Date.now()}`,
    createdAt: plan.createdAt || new Date().toISOString(),
    ...plan,
  }
  list.unshift(record)
  writeList(PLAN_KEY, list.slice(0, 50))
  return record
}

export const getPlans = () => readList(PLAN_KEY)

export const deletePlan = (id) => {
  const plans = readList(PLAN_KEY)
  const next = plans.filter((item) => String(item.id) !== String(id))
  writeList(PLAN_KEY, next)
  return next
}

export const getPlanById = (id) => readList(PLAN_KEY).find((item) => String(item.id) === String(id))

export const favoriteId = (city, name) => `${String(city || '').trim()}-${String(name || '').trim()}`

export const getFavorites = () => readList(FAVORITE_KEY)

export const isFavorite = (id) => getFavorites().some((item) => item.id === id)

export const saveFavorite = (favorite) => {
  const list = getFavorites()
  if (list.some((item) => item.id === favorite.id)) return list
  const record = { ...favorite, savedAt: new Date().toISOString() }
  const next = [record, ...list]
  writeList(FAVORITE_KEY, next)
  return next
}

export const deleteFavorite = (id) => {
  const next = getFavorites().filter((item) => item.id !== id)
  writeList(FAVORITE_KEY, next)
  return next
}

export const saveChatSession = (session) => {
  const list = readList(CHAT_KEY)
  const record = {
    id: session.id || `${Date.now()}`,
    title: session.title || 'AI对话',
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: session.messages || [],
    ...session,
  }
  const index = list.findIndex((item) => item.id === record.id)
  if (index >= 0) {
    list[index] = { ...list[index], ...record }
  } else {
    list.unshift(record)
  }
  writeList(CHAT_KEY, list.slice(0, 100))
  return record
}

export const getChatSessions = () => readList(CHAT_KEY)

export const getChatSessionById = (id) => readList(CHAT_KEY).find((item) => item.id === id)
