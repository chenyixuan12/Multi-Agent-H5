import axios from 'axios'
export const request = axios.create({
    baseURL: '/api/travel',
    timeout: 120000,
    headers: {
        'Content-Type': 'application/json'
    }
})
//封装请求拦截器
request.interceptors.request.use(
    (config) => {
        return config
    },
    (error) => {
        return Promise.reject(error)
    }
)
//封装响应拦截器
request.interceptors.response.use(
    (response) => {
        return response
    },
    (error) => {
        return Promise.reject(error)
    }
)

//封装post
export function post(url, data) {
    return request.post(url, data)
}
//封装get
export function get(url, params) {
    return request.get(url, { params })
}

const parseSseBlock = (block) => {
    const event = { event: 'message', data: '' }
    const lines = String(block || '').split(/\r?\n/)
    for (const line of lines) {
        if (!line) continue
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) {
            event.event = line.slice(6).trim() || 'message'
            continue
        }
        if (line.startsWith('id:')) {
            event.id = line.slice(3).trim()
            continue
        }
        if (line.startsWith('retry:')) {
            const retry = Number(line.slice(6).trim())
            if (!Number.isNaN(retry)) event.retry = retry
            continue
        }
        if (line.startsWith('data:')) {
            event.data += `${line.slice(5).trimStart()}\n`
        }
    }
    event.data = event.data.replace(/\n$/, '')
    return event
}

const safeJsonParse = (value) => {
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

//流式接口
export async function fetchStream(url, data, onChunk, onComplete, onError, onEvent) {
    const controller = new AbortController()
    let completed = false
    let failed = false
    try {
        const response = await fetch(`/api/travel/${url}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
            },
            body: JSON.stringify(data),
            signal: controller.signal
        })

        if (!response.ok) {
            let message = `请求失败（${response.status}）`
            try {
                const payload = await response.json()
                message = payload?.message || message
            } catch {
                // Keep the HTTP status when the response is not JSON.
            }
            throw new Error(message)
        }

        if (!response.body) {
            throw new Error('当前浏览器不支持流式响应')
        }
        
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''

        const safeCall = (fn, ...args) => {
            if (typeof fn !== 'function') return undefined
            try {
                return fn(...args)
            } catch (callbackError) {
                console.error('流式回调处理失败:', callbackError)
                return undefined
            }
        }

        const flushBlock = (rawBlock) => {
            if (!rawBlock || !rawBlock.trim()) return
            const parsed = parseSseBlock(rawBlock)
            const jsonData = safeJsonParse(parsed.data) || { raw: parsed.data }

            if (parsed.event === 'error' || jsonData?.type === 'error' || jsonData?.error) {
                failed = true
                completed = true
                safeCall(onError, jsonData?.message || jsonData?.error || '流式请求失败')
                return
            }

            if (parsed.event === 'end') {
                if (!completed && !failed) {
                    completed = true
                    safeCall(onComplete, jsonData?.data ?? jsonData)
                }
                return
            }

            if (jsonData && typeof jsonData === 'object') {
                safeCall(onEvent, jsonData)
                if (jsonData.type === 'chunk') {
                    safeCall(onChunk, jsonData.content || '')
                } else if (jsonData.type === 'complete' || jsonData.type === 'template') {
                    if (completed) return
                    completed = true
                    safeCall(onComplete, jsonData.data)
                }
            }
        }
        
        
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            pending += decoder.decode(value, { stream: true })
            const blocks = pending.split(/\r?\n\r?\n/)
            pending = blocks.pop() || ''
            blocks.forEach(flushBlock)
        }

        pending += decoder.decode()
        if (pending.trim()) flushBlock(pending)
        
        if (!completed) {
            completed = true
            onComplete?.(null)
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            failed = true
            completed = true
            onError?.(error.message || '流式请求失败')
        }
    }
}
