import Fragment from './Fragment';
import { isArray, isObject } from 'utils/is';
import { toEscapedString, toString, unbind, unrender, unrenderAndDestroy, update } from 'shared/methodCallers';

function getRefs ( ref, value, parent ) {
	let refs;

	if ( ref ) {
		refs = {};
		Object.keys( parent ).forEach( ref => {
			refs[ ref ] = parent[ ref ];
		});
		refs[ ref ] = value;
	} else {
		refs = parent;
	}

	return refs;
}

export default class RepeatedFragment {
	constructor ( options ) {
		this.parent = options.owner.parentFragment;

		// bit of a hack, so reference resolution works without another
		// layer of indirection
		this.parentFragment = this;
		this.owner = options.owner;
		this.ractive = this.parent.ractive;

		this.template = options.template;

		this.indexRef = options.indexRef;
		this.keyRef = options.keyRef;

		this.pendingNewIndices = null;
		this.indexByKey = null; // for `{{#each object}}...`
	}

	bind ( context ) {
		this.context = context;

		// {{#each array}}...
		if ( isArray( context.value ) ) {
			// we can't use map, because of sparse arrays
			this.iterations = [];
			for ( let i = 0; i < context.value.length; i += 1 ) {
				this.iterations[i] = this.createIteration( i, i );
			}
		}

		// {{#each object}}...
		else if ( isObject( context.value ) ) {
			// TODO this is a dreadful hack. There must be a neater way
			if ( this.indexRef ) {
				const [ keyRef, indexRef ] = this.indexRef.split( ',' );
				this.keyRef = keyRef;
				this.indexRef = indexRef;
			}

			this.indexByKey = {};
			this.iterations = Object.keys( context.value ).map( ( key, index ) => {
				this.indexByKey[ key ] = index;
				return this.createIteration( key, index );
			});
		}

		return this;
	}

	bubble () {
		this.owner.bubble();
	}

	createIteration ( key, index ) {
		const parentFragment = this.owner.parentFragment;
		const keyRefs = getRefs( this.keyRef, key, parentFragment.keyRefs );
		const indexRefs = getRefs( this.indexRef, index, parentFragment.indexRefs );

		const fragment = new Fragment({
			owner: this,
			template: this.template,
			indexRefs,
			keyRefs
		});

		// TODO this is a bit hacky
		fragment.key = key;
		fragment.index = index;
		fragment.isIteration = true;

		const model = this.context.joinKey( key );
		return fragment.bind( model );
	}

	detach () {
		const docFrag = document.createDocumentFragment();
		this.iterations.forEach( fragment => docFrag.appendChild( fragment.detach() ) );
		return docFrag;
	}

	find ( selector ) {
		const len = this.iterations.length;
		let i;

		for ( i = 0; i < len; i += 1 ) {
			const found = this.iterations[i].find( selector );
			if ( found ) return found;
		}
	}

	findAll ( selector, queryResult ) {
		const len = this.iterations.length;
		let i;

		for ( i = 0; i < len; i += 1 ) {
			this.iterations[i].findAll( selector, queryResult );
		}
	}

	findComponent ( name ) {
		const len = this.iterations.length;
		let i;

		for ( i = 0; i < len; i += 1 ) {
			const found = this.iterations[i].findComponent( name );
			if ( found ) return found;
		}
	}

	findAllComponents ( name, queryResult ) {
		const len = this.iterations.length;
		let i;

		for ( i = 0; i < len; i += 1 ) {
			this.iterations[i].findAllComponents( name, queryResult );
		}
	}

	findNextNode ( iteration ) {
		if ( iteration.index < this.iterations.length - 1 ) {
			return this.iterations[ iteration.index + 1 ].firstNode();
		}

		return this.owner.findNextNode();
	}

	firstNode () {
		return this.iterations[0] ? this.iterations[0].firstNode() : null;
	}

	rebind ( context ) {
		this.context = context;

		// {{#each array}}...
		if ( isArray( context.value ) ) {
			this.iterations.forEach( ( fragment, i ) => {
				fragment.rebind( context.joinKey( i ) );
			});
		}
	}

	render () {
		// TODO use docFrag.cloneNode...

		const docFrag = document.createDocumentFragment();

		if ( this.iterations ) {
			this.iterations.forEach( fragment => docFrag.appendChild( fragment.render() ) );
		}

		return docFrag;
	}

	shuffle ( newIndices ) {
		if ( this.pendingNewIndices ) {
			throw new Error( 'Section was already shuffled!' );
		}

		this.pendingNewIndices = newIndices;
		this.previousIterations = this.iterations.slice();

		const iterations = [];

		newIndices.forEach( ( newIndex, oldIndex ) => {
			if ( newIndex === -1 ) return;

			const fragment = this.iterations[ oldIndex ];
			iterations[ newIndex ] = fragment;

			if ( newIndex !== oldIndex ) fragment.dirty = true;
		});

		this.iterations = iterations;
		this.bubble();
	}

	toString ( escape ) {
		return this.iterations ?
			this.iterations.map( escape ? toEscapedString : toString ).join( '' ) :
			'';
	}

	unbind () {
		this.iterations.forEach( unbind );
		return this;
	}

	unrender ( shouldDestroy ) {
		this.iterations.forEach( shouldDestroy ? unrenderAndDestroy : unrender );
	}

	// TODO smart update
	update () {
		// skip dirty check, since this is basically just a facade

		if ( this.pendingNewIndices ) {
			this.updatePostShuffle();
			return;
		}

		const value = this.context.value;

		let toRemove;
		let oldKeys;

		if ( isArray( value ) ) {
			if ( this.iterations.length > value.length ) {
				toRemove = this.iterations.splice( value.length );
			}
		} else if ( isObject( value ) ) {
			toRemove = [];
			oldKeys = {};
			let i = this.iterations.length;

			while ( i-- ) {
				const fragment = this.iterations[i];
				if ( fragment.key in value ) {
					oldKeys[ fragment.key ] = true;
				} else {
					this.iterations.splice( i, 1 );
					toRemove.push( fragment );
				}
			}
		} else {
			toRemove = this.iterations;
			this.iterations = [];
		}

		if ( toRemove ) {
			toRemove.forEach( fragment => {
				fragment.unbind();
				fragment.unrender( true );
			});
		}

		// update the remaining ones
		this.iterations.forEach( update );

		// add new iterations
		const newLength = isArray( value ) ?
			value.length :
			isObject( value ) ?
				Object.keys( value ).length :
				0;

		if ( newLength > this.iterations.length ) {
			const docFrag = document.createDocumentFragment();
			let i = this.iterations.length;

			if ( isArray( value ) ) {
				while ( i < value.length ) {
					const fragment = this.createIteration( i, i );

					this.iterations.push( fragment );
					docFrag.appendChild( fragment.render() );

					i += 1;
				}
			}

			else if ( isObject( value ) ) {
				Object.keys( value ).forEach( key => {
					if ( !( key in oldKeys ) ) {
						const fragment = this.createIteration( key, i );

						this.iterations.push( fragment );
						docFrag.appendChild( fragment.render() );

						i += 1;
					}
				});
			}

			const parentNode = this.parent.findParentNode();
			const anchor = this.parent.findNextNode( this );

			parentNode.insertBefore( docFrag, anchor );
		}
	}

	updatePostShuffle () {
		const newIndices = this.pendingNewIndices;
		const docFrag = document.createDocumentFragment();
		const parentNode = this.parent.findParentNode();

		// TODO reorder fragments in the DOM...
		newIndices.forEach( ( newIndex, oldIndex ) => {
			const fragment = this.previousIterations[ oldIndex ];

			if ( newIndex === -1 ) {
				fragment.unbind().unrender( true );
			} else {
				fragment.rebind( this.context.joinKey( newIndex ) );
			}
		});

		// create new iterations
		const len = this.context.value.length;
		let i;

		for ( i = 0; i < len; i += 1 ) {
			let fragment = this.iterations[i];

			if ( fragment ) {
				if ( docFrag.childNodes.length ) {
					parentNode.insertBefore( docFrag, fragment.firstNode() );
				}
			} else {
				fragment = this.createIteration( i, i );
				this.iterations[i] = fragment;

				docFrag.appendChild( fragment.render() );
			}
		}

		this.iterations.forEach( update );

		if ( docFrag.childNodes.length ) {
			parentNode.insertBefore( docFrag, this.owner.findNextNode() );
		}

		this.pendingNewIndices = null;
	}
}
