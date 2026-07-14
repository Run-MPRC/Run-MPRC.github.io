import { BrowserRouter, Route, Routes } from 'react-router-dom';
import React, { lazy, Suspense } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import Home from './pages/home/Home';
import About from './pages/about/About';
import Contact from './pages/contact/Contact';
import NotFound from './pages/notFound/NotFound';
import Committee from './pages/officers/Committee';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ErrorBoundary from './components/ErrorBoundary';
import Activities from './pages/activities/Activities';
import ServiceLocatorProvider from './services/ServiceLocatorProvider';
import LoginForm from './pages/login/LoginForm';
import VerifyEmailAction from './pages/login/VerifyEmailAction';
import Events from './pages/events/Events';
import EventDetail from './pages/events/EventDetail';
import EventRegister from './pages/events/EventRegister';
import RegisterSuccess from './pages/events/RegisterSuccess';
import EventCalendar from './pages/events/EventCalendar';
import Shop from './pages/shop/Shop';
import ProductDetail from './pages/shop/ProductDetail';
import PurchaseSuccess from './pages/shop/PurchaseSuccess';
import Account from './pages/account/Account';
import StravaCallback from './pages/account/StravaCallback';
import ScrollToTop from './components/ScrollToTop';
import AnnouncementBanner from './components/AnnouncementBanner';
import JoinUsConditionalRoute from './pages/joinUs/JoinUsConditionalRoute';
import Terms from './pages/legal/Terms';
import Privacy from './pages/legal/Privacy';

// Admin pages are lazy-loaded so public visitors don't download the admin JS bundle.
const Admin = lazy(() => import('./pages/admin/AdminHome'));
const AdminEventsList = lazy(() => import('./pages/admin/events/AdminEventsList'));
const AdminEventEditor = lazy(() => import('./pages/admin/events/AdminEventEditor'));
const AdminEventRegistrations = lazy(() => import('./pages/admin/events/AdminEventRegistrations'));
const AdminMembers = lazy(() => import('./pages/admin/members/AdminMembers'));
const AdminProducts = lazy(() => import('./pages/admin/shop/AdminProducts'));
const AdminProductEditor = lazy(() => import('./pages/admin/shop/AdminProductEditor'));
const AdminOrders = lazy(() => import('./pages/admin/shop/AdminOrders'));

const AdminFallback = (
  <div className="container mx-auto p-6 text-sm text-gray-500">Loading admin...</div>
);

const ROUTER_FUTURE_FLAGS = Object.freeze({
  v7_relativeSplatPath: true,
  v7_startTransition: true,
});

function App() {
  return (
    <HelmetProvider>
      <ServiceLocatorProvider>
        <BrowserRouter future={ROUTER_FUTURE_FLAGS}>
          <a href="#main-content" className="skip-to-content">Skip to content</a>
          <Navbar />
          <AnnouncementBanner />
          <ScrollToTop />
          <main id="main-content">
            <ErrorBoundary>
              <Routes>
                <Route index element={<Home />} />
                <Route path="admin" element={<Suspense fallback={AdminFallback}><Admin /></Suspense>} />
                <Route path="admin/events" element={<Suspense fallback={AdminFallback}><AdminEventsList /></Suspense>} />
                <Route path="admin/events/new" element={<Suspense fallback={AdminFallback}><AdminEventEditor /></Suspense>} />
                <Route path="admin/events/:slug/edit" element={<Suspense fallback={AdminFallback}><AdminEventEditor /></Suspense>} />
                <Route path="admin/events/:slug/registrations" element={<Suspense fallback={AdminFallback}><AdminEventRegistrations /></Suspense>} />
                <Route path="admin/members" element={<Suspense fallback={AdminFallback}><AdminMembers /></Suspense>} />
                <Route path="admin/products" element={<Suspense fallback={AdminFallback}><AdminProducts /></Suspense>} />
                <Route path="admin/products/new" element={<Suspense fallback={AdminFallback}><AdminProductEditor /></Suspense>} />
                <Route path="admin/products/:slug/edit" element={<Suspense fallback={AdminFallback}><AdminProductEditor /></Suspense>} />
                <Route path="admin/orders" element={<Suspense fallback={AdminFallback}><AdminOrders /></Suspense>} />
                <Route path="about" element={<About />} />
                <Route path="activities" element={<Activities />} />
                <Route path="events" element={<Events />} />
                <Route path="events/calendar" element={<EventCalendar />} />
                <Route path="events/:slug" element={<EventDetail />} />
                <Route path="events/:slug/register" element={<EventRegister />} />
                <Route path="register/success" element={<RegisterSuccess />} />
                <Route path="shop" element={<Shop />} />
                <Route path="shop/purchase/success" element={<PurchaseSuccess />} />
                <Route path="shop/:slug" element={<ProductDetail />} />
                <Route path="account" element={<Account />} />
                <Route path="account/strava/callback" element={<StravaCallback />} />
                <Route path="contact" element={<Contact />} />
                <Route path="joinus" element={<JoinUsConditionalRoute />} />
                <Route path="committee" element={<Committee />} />
                <Route path="login" element={<LoginForm />} />
                <Route path="auth/action" element={<VerifyEmailAction />} />
                <Route path="terms" element={<Terms />} />
                <Route path="privacy" element={<Privacy />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
          </main>
          <Footer />
        </BrowserRouter>
      </ServiceLocatorProvider>
    </HelmetProvider>
  );
}

export default App;
