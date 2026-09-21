import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const file = new URL('./collabify-student-dashboard.html', import.meta.url)
const host = '127.0.0.1'
const port = 5174

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  const path = new URL(request.url, `http://${host}:${port}`).pathname
  if (path !== '/' && path !== '/collabify-student-dashboard.html') {
    response.writeHead(404).end('Not found')
    return
  }
  try {
    const content = await readFile(file)
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    })
    response.end(request.method === 'HEAD' ? undefined : content)
  } catch {
    response.writeHead(500).end('Could not load the dashboard preview.')
  }
}).listen(port, host, () => {
  console.log(`Dashboard preview: http://${host}:${port}`)
})
