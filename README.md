# WornVault

WornVault is a premium resale marketplace for content creators, inspired by the StockX operating model.

The platform allows verified creators to sell one-of-a-kind, creator-owned items while WornVault handles trust, logistics, validation, and fulfillment. Buyers receive platform-backed authenticity, discretion, and a luxury experience. Creators are freed from admin work, privacy risk, and fulfillment headaches.

WornVault is designed to be **frictionless for creators**, **trust-first for buyers**, and **operationally lean** for the platform.

---

## Product Objectives

- Enable creators to sell items with minimal effort and zero buyer interaction  
- Act as a trusted intermediary (not peer-to-peer)  
- Hold no unsold inventory — items move only after purchase  
- Validate and authenticate all items before delivery  
- Provide discreet, professional, luxury-grade fulfillment  
- Prioritize trust, privacy, and operational clarity over feature volume  

The MVP focuses on proving:
- Creator adoption
- Repeat listings
- Reliable logistics
- Willingness to pay premium fees for friction removal

---

## Tech Stack

### Frontend & Commerce
- **Shopify Hydrogen** (React + Remix)
- **Shopify Oxygen** (edge hosting)
- **Shopify Checkout** (payments, fraud, taxes)

### Backend & Data
- **Supabase**
  - Postgres (core data + state)
  - Auth (magic link + Google OAuth)
  - Storage (reference & intake photos)
  - Row Level Security (RLS)

### Core Responsibilities
- **Shopify**: products, orders, checkout, payments  
- **Supabase**: creators, listings, logistics state, payouts, admin workflows  

This separation keeps commerce stable and marketplace logic flexible.

---

## Architecture Principles

- Humans run ops first, automation comes later  
- Status + event logs over hidden logic  
- Minimal MVP surface area  
- Security enforced at the database level  
- Infrastructure is outsourced; trust, logistics, and brand are owned  

---

## MVP Scope

Included:
- Creator onboarding & verification
- Creator dashboard
- Listing creation with reference photos
- Public product & creator pages
- Purchase → ship → validate → deliver flow
- Manual admin operations

Explicitly excluded from MVP:
- Messaging
- Reviews
- Buyer accounts
- Wishlists
- Analytics dashboards
- AI dependencies

---

## Guiding Principle

> WornVault is a trust engine with a checkout — not a feature-rich marketplace.

