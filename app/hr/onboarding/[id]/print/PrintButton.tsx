'use client'

export default function PrintButton() {
  return <p className="noprint"><button className="btn" type="button" onClick={() => window.print()}>Print</button></p>
}
