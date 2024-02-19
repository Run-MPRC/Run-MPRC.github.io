// rafce -> shortcut to create component and export
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import Home from './pages/home/Home';
import About from './pages/about/About';
import Contact from './pages/contact/Contact';
import NotFound from './pages/notFound/NotFound';
import Committee from './pages/officers/Committee';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Activities from './pages/activities/Activities';
import ServiceLocatorProvider from './services/ServiceLocatorProvider';
import LoginForm from './pages/login/LoginForm';
import Admin from './pages/admin/Admin';
import Events from './pages/events/Events.tsx';
import ScrollToTop from './components/ScrollToTop';
import JoinUsConditionalRoute from './pages/joinUs/JoinUsConditionalRoute';

function App() {
  return (
    <ServiceLocatorProvider>
      <BrowserRouter>
        <Navbar />
        <ScrollToTop />
        <Routes>
          <Route index element={<Home />} />
          <Route path="admin" element={<Admin />} />
          <Route path="about" element={<About />} />
          <Route path="activities" element={<Activities />} />
          <Route path="events" element={<Events />} />
          <Route path="contact" element={<Contact />} />
          <Route path="joinus" element={<JoinUsConditionalRoute />} />
          <Route path="committee" element={<Committee />} />
          <Route path="login" element={<LoginForm />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Footer />
      </BrowserRouter>
    </ServiceLocatorProvider>
  );
}

export default App;
