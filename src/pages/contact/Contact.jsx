import React from 'react';
import './contact.css';
import { MdEmail } from 'react-icons/md';
import Header from '../../components/Header';
import HeaderImage from '../../images/contact/header_bg_2.jpg';
import { CONTACT_DESCRIPTION, CONTACT_TITLE } from '../../text/ContactUs';

function Contact() {
  return (
    <>
      <Header title={CONTACT_TITLE} image={HeaderImage} />

      <section className="contact">
        <div className="container contact__container">
          {CONTACT_DESCRIPTION}
          <div className="contact__wrapper">
            <a
              href="mailto:runmprc@gmail.com"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Send an email to runmprc@gmail.com"
            >
              <MdEmail />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

export default Contact;
