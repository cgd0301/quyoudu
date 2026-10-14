const fallback = process.platform === 'win32' ? 'python' : 'python3'

export const pythonCmd = process.env.PYTHON ?? fallback
