import React from 'react';
import './Admin.css';
import Header from '../../components/Header';
import HeaderImage from '../../images/contact/header_bg_2.jpg';
import SEO from '../../components/SEO';

function Admin() {
  return (
    <>
      <SEO title="Admin Panel" noindex />
      <Header title="Admin Panel" image={HeaderImage} />
      <section className="admin">
        <div className="container admin__container">
          <p>Admin panel content will be available here for authorized users.</p>
        </div>
      </section>
    </>
  );
}

export default Admin;
