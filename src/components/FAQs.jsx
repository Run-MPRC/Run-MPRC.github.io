import React from 'react';
import { FaQuestion } from 'react-icons/fa';
import { faqs } from '../data';
import FAQ from './FAQ';
import SectionHead from './SectionHead';

// TODO: REMOVE
function FAQs() {
  return (
    <section className="faqs">
      <div className="container faqs__container">
        <SectionHead icon={<FaQuestion />} title="FAQs" />
        <div className="faqs__wrapper">
          {faqs.map(({ id, question, answer }) => <FAQ key={id} question={question} answer={answer} />)}
        </div>
      </div>
    </section>
  );
}

export default FAQs;
