import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { FaBars } from 'react-icons/fa';
import { MdOutlineClose } from 'react-icons/md';
import { links } from '../data';
import './navbar.css';
import Logo from '../assets/images/logo.svg';

function Navbar() {
  const [isNavShowing, setIsNavShowing] = useState(false);

  const handleNavToggle = () => setIsNavShowing((prevVAlue) => !prevVAlue);

  const baseAnimationDelay = 100;
  const staggeredAnimationDelayIncrement = 50;

  const animationDelay = (index) => ({
    animationDelay: `${
      baseAnimationDelay + index * staggeredAnimationDelayIncrement
    }ms`,
  });
  return (
    <nav>
      <div className="container nav__container">
        <Link to="/" className="logo" onClick={handleNavToggle}>
          <img src={Logo} alt="Nav-logo" />
        </Link>
        <ul
          className={`nav__links ${isNavShowing ? 'show__nav' : 'hide__nav'}`}
        >
          {/* Destructure the links array of object from the links to get each item */}
          {links.map(({ name, path }, index) => (
            <li key={name} style={animationDelay(index)}>
              <NavLink
                to={path}
                className={({ isActive }) => (isActive ? 'active-nav' : '')}
                onClick={handleNavToggle}
              >
                {name}
              </NavLink>
            </li>
          ))}

        </ul>
        <button
          type="button"
          onClick={handleNavToggle}
          className="nav__toggle-btn"
        >
          {isNavShowing ? <MdOutlineClose /> : <FaBars />}
        </button>

      </div>
    </nav>
  );
}

export default Navbar;
