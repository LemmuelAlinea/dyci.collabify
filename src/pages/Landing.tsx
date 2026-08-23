import { useEffect } from 'react'
import { Navbar } from '../components/landing/Navbar'
import { Hero } from '../components/landing/Hero'
import { Features } from '../components/landing/Features'
import { Flow } from '../components/landing/Flow'
import { Boundaries } from '../components/landing/Boundaries'
import { ForRoles } from '../components/landing/ForRoles'
import { CTA } from '../components/landing/CTA'
import { Footer } from '../components/landing/Footer'

export default function Landing() {
  useEffect(() => {
    document.title = 'Collabify — Project workspace for BSIT teams'
  }, [])

  return (
    <div className="min-h-dvh">
      <Navbar />
      <main>
        <Hero />
        <Flow />
        <Features />
        <ForRoles />
        <Boundaries />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
