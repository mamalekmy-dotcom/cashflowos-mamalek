'use client'
import { useState, useTransition } from 'react'
import { addProduct, addSupplier } from './actions'

export function AddSupplier() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await addSupplier(name, phone)
      setMessage(result.message)
      if (result.ok) {
        setName('')
        setPhone('')
      }
    })
  }

  return (
    <form className="admin-card" onSubmit={submit}>
      <p className="rowlabel">Add supplier</p>
      <input className="login-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      <input className="login-input" inputMode="tel" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} style={{ marginTop: 10 }} />
      {message ? <p className="cap" style={{ margin: '10px 0 0' }}>{message}</p> : null}
      <button className="btn" type="submit" disabled={pending || !name} style={{ marginTop: 12 }}>Add supplier</button>
    </form>
  )
}

export function AddProduct({ supplierId }: { supplierId: number }) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [price, setPrice] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const result = await addProduct(supplierId, name, unit, price)
      if (result.ok) {
        setName('')
        setUnit('')
        setPrice('')
      }
    })
  }

  return (
    <form className="btnrow" onSubmit={submit} style={{ marginTop: 10 }}>
      <input className="login-input" placeholder="Product" aria-label="Product" value={name} onChange={e => setName(e.target.value)} />
      <input className="login-input" placeholder="Unit" aria-label="Unit" value={unit} onChange={e => setUnit(e.target.value)} />
      <input className="login-input" inputMode="decimal" placeholder="RM" aria-label="Price" value={price} onChange={e => setPrice(e.target.value)} />
      <button className="btn ghost" type="submit" disabled={pending || !name}>Add</button>
    </form>
  )
}
