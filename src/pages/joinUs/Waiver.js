import React, { useState } from 'react'; 
import Header from '../../components/Header';
import { useNavigate } from 'react-router-dom';
import FlexColumnContainer from '../../components/FlexColumnContainer';
import { ServiceLocatorContext } from '../../services/ServiceLocatorContext';


const Waiver = ({ onWaiverSubmit }) => {
    const { firebaseResources } = useContext(ServiceLocatorContext);
    const analytics = firebaseResources.analytics();
    

    const [isAgreed, setIsAgreed] = useState(false);
    const navigate = useNavigate();

    const handleCheckboxChange = (event) => {
        setIsAgreed(event.target.checked);
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        analytics.logEvent('signed_waiver', {
            signed: isAgreed
        });
        if (isAgreed) {
            localStorage.setItem('waiverSigned', 'true');
            onWaiverSubmit();
        } else {
            navigate('/');
        }
    };

    return (
        <FlexColumnContainer>
            <Header title="Waiver" />
            <h1>Waiver</h1>
            <form onSubmit={handleSubmit}>
                <p>I understand that participating in group runs, social events, and races are potentially hazardous activities that could cause injury or death. I will not participate in any group activities unless I am medically able and properly trained. I assume all risks associated with being a member of this group and participating in its activities, which may include, but are not limited to: falls, contact with other participants, effects of the weather, traffic, and road conditions. Having read this waiver and knowing these facts, I waive and release the group organizers and hosts, the Mid-Peninsula Running Club (including its officers and other members), all sponsors, and their representatives and successors from all claims or liabilities of any kind arising out of my participation in group activities, even though that liability may arise out of negligence or carelessness on the part of persons named in this waiver. By participating in this group, I accept these terms and conditions.</p>
                <label>
                    <input
                        type="checkbox"
                        checked={isAgreed}
                        onChange={handleCheckboxChange}
                    />
                    I agree to the terms and conditions.
                </label>
                <button type="submit">Submit</button>
            </form>
        </FlexColumnContainer>
    );
};

export default Waiver;
