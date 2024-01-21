// rafce -> shortcut to create component and export
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import Home from './pages/home/Home';
import About from './pages/about/About';
import Contact from './pages/contact/Contact';
// import Gallery from "./pages/gallery/Gallery";
import NotFound from './pages/notFound/NotFound';
import Committee from './pages/officers/Committee';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import JoinUs from './pages/joinUs/JoinUs';
import Activities from './pages/activities/Activities';
import ScrollToTop from './components/ScrollToTop';

function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <ScrollToTop />
      <Routes>
        <Route index element={<Home />} />
        <Route path="about" element={<About />} />
        <Route path="activities" element={<Activities />} />
        <Route path="contact" element={<Contact />} />
        {/* TODO(Jeffrey): do we need this */}
        {/* <Route path="gallery" element={<Gallery/>}/> */}
        <Route path="joinus" element={<JoinUs />} />
        <Route path="committee" element={<Committee />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </BrowserRouter>
  );
}

export default App;
