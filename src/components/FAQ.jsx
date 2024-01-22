import React, { useState } from 'react';
import { AiOutlinePlus, AiOutlineMinus } from 'react-icons/ai';

function FAQ({ question, answer }) {
  const [isAnswerShowing, setIsAnswerShowing] = useState(false);

  const handleFAQ = () => setIsAnswerShowing((prevValue) => !prevValue);

  return (
    <article className="faq" onClick={handleFAQ}>
      <div>
        <h4>{question}</h4>
        <button className="faq__icon">
          {isAnswerShowing ? <AiOutlineMinus /> : <AiOutlinePlus />}
        </button>
      </div>
      {isAnswerShowing && <p>{answer}</p>}
    </article>
  );
}

export default FAQ;
