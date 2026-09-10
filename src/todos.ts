export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  id: string
  content: string
  status: TodoStatus
  parentId?: string
}

function key(sessionId: string) {
  return `pdn.todos.${sessionId || 'none'}`
}

export function loadTodos(sessionId: string): TodoItem[] {
  if (!sessionId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(key(sessionId)) || '[]') as TodoItem[]
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item.content) : []
  } catch {
    return []
  }
}

export function saveTodos(sessionId: string, todos: TodoItem[]) {
  if (!sessionId) return
  localStorage.setItem(key(sessionId), JSON.stringify(todos))
}

export function newTodo(content: string, parentId?: string): TodoItem {
  return {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content: content.trim(),
    status: 'pending',
    parentId
  }
}

export function todoTree(list: TodoItem[]) {
  const roots = list.filter((item) => !item.parentId || !list.some((other) => other.id === item.parentId))
  const children = (id: string) => list.filter((item) => item.parentId === id)
  return { roots, children }
}

export function cycleTodoStatus(status: TodoStatus): TodoStatus {
  if (status === 'pending') return 'in_progress'
  if (status === 'in_progress') return 'completed'
  return 'pending'
}
