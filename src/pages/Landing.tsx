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
    document.title = "Collabify — BSIT coursework at Dr. Yanga's Colleges"
  }, [])

  return (
    <div className="min-h-dvh">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
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
