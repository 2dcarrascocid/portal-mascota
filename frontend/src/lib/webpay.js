// Envía al usuario al formulario de pago de Webpay: un form POST a `url`
// con el campo token_ws (así lo exige Transbank). Al terminar, Transbank
// vuelve al backend (/webpay/retorno) y este redirige a /pago/resultado.
export function irAWebpay({ url, token }) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = url
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'token_ws'
  input.value = token
  form.appendChild(input)
  document.body.appendChild(form)
  form.submit()
}
