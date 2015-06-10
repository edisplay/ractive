import { ELEMENT, INTERPOLATOR, PARTIAL, SECTION } from '../../config/types';
import Element from './Element';
import Interpolator from './Interpolator';
import Partial from './Partial';
import Section from './Section';
import Text from './Text';

const constructors = {
	[ ELEMENT ]: Element,
	[ INTERPOLATOR ]: Interpolator,
	[ PARTIAL ]: Partial,
	[ SECTION ]: Section
}

export default function createItem ( options ) {
	if ( typeof options.template === 'string' ) {
		return new Text( options.template );
	}

	const Item = constructors[ options.template.t ];

	if ( !Item ) throw new Error( `Unrecognised item type ${options.template.t}` );

	return new Item( options );
}
